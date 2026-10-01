import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { statusKey } from "../render.js";
import { ALL, categoryOf, countStatus, searchUrl, statusJql } from "../tickets.js";
import { handlePi, openUrl, toDataUrl, type Ctx } from "./context.js";

type Settings = {
	status?: string;
	/** Empty follows the project dial; "*" is all projects; else a project key. */
	project?: string;
};

/** Counts my open-sprint tickets in one status. Press opens that search in Jira. */
@action({ UUID: "com.boxofraccoons.jira-herdr.status" })
export class StatusKey extends SingletonAction<Settings> {
	private shown = new Map<string, { action: KeyAction<Settings>; settings: Settings; last: string }>();

	constructor(private ctx: Ctx) {
		super();
		ctx.service.onChange(() => {
			for (const id of this.shown.keys()) void this.draw(id);
		});
	}

	private projectFor(s: Settings): string {
		return s.project?.trim() || this.ctx.service.project;
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!ev.action.isKey()) return;
		this.shown.set(ev.action.id, { action: ev.action, settings: ev.payload.settings, last: "" });
		this.ctx.service.start();
		await this.draw(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.shown.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		const v = this.shown.get(ev.action.id);
		if (!v) return;
		v.settings = ev.payload.settings;
		await this.draw(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const status = ev.payload.settings.status?.trim();
		const site = this.ctx.service.site;
		if (!status || !site) return ev.action.showAlert();
		if (!(await openUrl(searchUrl(site, statusJql(status, this.projectFor(ev.payload.settings)))))) {
			streamDeck.logger.warn("status key: could not open the browser");
			await ev.action.showAlert();
		}
		void this.ctx.service.refreshIfStale();
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
		return handlePi(this.ctx, ev.payload);
	}

	private async draw(id: string): Promise<void> {
		const v = this.shown.get(id);
		if (!v) return;
		const { issues, problem } = this.ctx.service;
		const status = v.settings.status?.trim() || null;
		const project = this.projectFor(v.settings);
		const image = toDataUrl(
			statusKey({
				status,
				project: project === ALL ? "All" : project,
				count: issues && status ? countStatus(issues, status, project) : null,
				category: issues && status ? categoryOf(issues, status) : null,
				problem,
			}),
		);
		if (image === v.last) return;
		v.last = image;
		await v.action.setImage(image);
	}
}
