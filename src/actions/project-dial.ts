import {
	action,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type SendToPluginEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { DialBrowser, SNAP_BACK_MS } from "../dial.js";
import { projectFeedback } from "../render.js";
import { projectItems, type ProjectItem } from "../tickets.js";
import { handlePi, type Ctx } from "./context.js";

type Settings = { project?: string };

const idOf = (p: ProjectItem) => p.id;

/**
 * Turn to preview projects with To Do tickets ("All" first); press or tap to
 * choose. Snaps back to the chosen one after a quiet spell. The choice is kept
 * in this dial's settings so it survives a restart.
 */
@action({ UUID: "com.boxofraccoons.jira-herdr.project-dial" })
export class ProjectDial extends SingletonAction<Settings> {
	private dials = new Map<string, { action: DialAction<Settings>; browser: DialBrowser; snapTimer: NodeJS.Timeout | null; last: string }>();

	constructor(private ctx: Ctx) {
		super();
		ctx.service.onChange(() => {
			for (const id of this.dials.keys()) void this.draw(id);
		});
	}

	private items(): ProjectItem[] | null {
		const { issues, project } = this.ctx.service;
		return issues ? projectItems(issues, project) : null;
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!ev.action.isDial()) return;
		this.dials.set(ev.action.id, { action: ev.action, browser: new DialBrowser(), snapTimer: null, last: "" });
		if (ev.payload.settings.project) this.ctx.service.setProject(ev.payload.settings.project);
		this.ctx.service.start();
		await this.draw(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		const d = this.dials.get(ev.action.id);
		if (d?.snapTimer) clearTimeout(d.snapTimer);
		this.dials.delete(ev.action.id);
	}

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const d = this.dials.get(ev.action.id);
		const items = this.items();
		void this.ctx.service.refreshIfStale();
		if (!d || !items) return;
		d.browser.turn(items, idOf, this.ctx.service.project, ev.payload.ticks, Date.now());
		if (d.snapTimer) clearTimeout(d.snapTimer);
		d.snapTimer = setTimeout(() => {
			d.snapTimer = null;
			void this.draw(ev.action.id);
		}, SNAP_BACK_MS + 50);
		await this.draw(ev.action.id);
	}

	override onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		return this.commit(ev.action.id);
	}

	override onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		return this.commit(ev.action.id);
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
		return handlePi(this.ctx, ev.payload);
	}

	private async commit(id: string): Promise<void> {
		const d = this.dials.get(id);
		const items = this.items();
		if (!d) return;
		if (!items) return d.action.showAlert();
		const target = d.browser.commit(items, idOf, this.ctx.service.project, Date.now());
		if (d.snapTimer) clearTimeout(d.snapTimer);
		d.snapTimer = null;
		if (target) {
			this.ctx.service.setProject(target);
			await d.action.setSettings({ project: target });
		}
		await this.draw(id);
	}

	private async draw(id: string): Promise<void> {
		const d = this.dials.get(id);
		if (!d) return;
		const items = this.items();
		const view = items ? d.browser.view(items, idOf, this.ctx.service.project, Date.now()) : null;
		const feedback = projectFeedback(view, this.ctx.service.problem);
		const key = JSON.stringify(feedback);
		if (key === d.last) return;
		d.last = key;
		await d.action.setFeedback(feedback);
	}
}
