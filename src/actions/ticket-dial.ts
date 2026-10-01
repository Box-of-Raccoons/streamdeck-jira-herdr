import streamDeck, {
	action,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type SendToPluginEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { Issue } from "../jira/client.js";
import { ArmGuard, ARM_MS, TicketCursor } from "../picker.js";
import { ACCENT, GREEN, RED, ticketFeedback, type Flash } from "../render.js";
import { sendTicket } from "../send.js";
import { ALL, browseUrl, fillPrompt, ticketsFor } from "../tickets.js";
import { handlePi, message, openUrl, type Ctx } from "./context.js";

type Settings = {
	/** Default "/work-ticket {key}". */
	prompt?: string;
	/** Folder new tabs open in; default home. */
	folder?: string;
	/** Agent kind; default claude. */
	agent?: string;
};

const keyOf = (i: Issue) => i.key;
const SENT_FLASH_MS = 4_000;
const FAIL_FLASH_MS = 8_000;
/** Long enough for /work-ticket to move the ticket out of To Do. */
const REFRESH_AFTER_SEND_MS = 20_000;

interface Dial {
	action: DialAction<Settings>;
	settings: Settings;
	cursor: TicketCursor;
	guard: ArmGuard;
	project: string;
	flash: Flash | null;
	flashTimer: NodeJS.Timeout | null;
	armTimer: NodeJS.Timeout | null;
	sending: boolean;
	last: string;
}

/**
 * Turn to scroll the chosen project's To Do tickets. Press once to arm, again
 * within 3 s to send to herdr; a turn cancels. Tap opens the ticket in Jira.
 */
@action({ UUID: "com.boxofraccoons.jira-herdr.ticket-dial" })
export class TicketDial extends SingletonAction<Settings> {
	private dials = new Map<string, Dial>();

	constructor(private ctx: Ctx) {
		super();
		ctx.service.onChange(() => {
			for (const id of this.dials.keys()) void this.draw(id);
		});
	}

	private items(d: Dial): Issue[] | null {
		const { issues, project } = this.ctx.service;
		if (project !== d.project) {
			d.project = project;
			d.cursor.reset();
			d.guard.cancel();
		}
		return issues ? ticketsFor(issues, project) : null;
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		if (!ev.action.isDial()) return;
		this.dials.set(ev.action.id, {
			action: ev.action,
			settings: ev.payload.settings,
			cursor: new TicketCursor(),
			guard: new ArmGuard(),
			project: this.ctx.service.project,
			flash: null,
			flashTimer: null,
			armTimer: null,
			sending: false,
			last: "",
		});
		this.ctx.service.start();
		await this.draw(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		const d = this.dials.get(ev.action.id);
		if (d?.flashTimer) clearTimeout(d.flashTimer);
		if (d?.armTimer) clearTimeout(d.armTimer);
		this.dials.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		const d = this.dials.get(ev.action.id);
		if (d) d.settings = ev.payload.settings;
	}

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const d = this.dials.get(ev.action.id);
		void this.ctx.service.refreshIfStale();
		if (!d) return;
		d.guard.cancel();
		this.clearFlash(d);
		const items = this.items(d);
		if (items) d.cursor.turn(items, keyOf, ev.payload.ticks);
		await this.draw(ev.action.id);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		const d = this.dials.get(ev.action.id);
		if (!d || d.sending) return;
		const items = this.items(d);
		const item = items ? d.cursor.view(items, keyOf).item : null;
		if (!item) return d.action.showAlert();
		if (d.guard.press(item.key, Date.now()) === "armed") {
			this.clearFlash(d);
			if (d.armTimer) clearTimeout(d.armTimer);
			d.armTimer = setTimeout(() => {
				d.armTimer = null;
				void this.draw(ev.action.id);
			}, ARM_MS + 50);
			return this.draw(ev.action.id);
		}
		if (d.armTimer) clearTimeout(d.armTimer);
		d.armTimer = null;
		await this.send(ev.action.id, d, item);
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const d = this.dials.get(ev.action.id);
		const items = d ? this.items(d) : null;
		const item = d && items ? d.cursor.view(items, keyOf).item : null;
		if (!d || !item || !this.ctx.service.site) return d?.action.showAlert();
		if (!(await openUrl(browseUrl(this.ctx.service.site, item.key)))) await d.action.showAlert();
	}

	override onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
		return handlePi(this.ctx, ev.payload);
	}

	private async send(id: string, d: Dial, item: Issue): Promise<void> {
		d.sending = true;
		this.setFlash(id, d, { heading: "SENDING", color: ACCENT, key: item.key, detail: "starting the agent…" }, null);
		try {
			const agent = await sendTicket(this.ctx.call, this.ctx.slowCall, {
				key: item.key,
				prompt: fillPrompt(d.settings.prompt, item, this.ctx.service.site),
				folder: d.settings.folder,
				kind: d.settings.agent,
				focus: true,
				home: this.ctx.home,
			});
			streamDeck.logger.info(`sent ${item.key} to herdr as ${agent}`);
			this.setFlash(id, d, { heading: "SENT", color: GREEN, key: item.key, detail: `running as ${agent}` }, SENT_FLASH_MS);
			await this.ctx.raise();
			setTimeout(() => void this.ctx.service.refresh(), REFRESH_AFTER_SEND_MS);
		} catch (e) {
			streamDeck.logger.warn(`send ${item.key}: ${message(e)}`);
			this.setFlash(id, d, { heading: "NOT SENT", color: RED, key: item.key, detail: message(e) }, FAIL_FLASH_MS);
			await d.action.showAlert();
		} finally {
			d.sending = false;
		}
	}

	private setFlash(id: string, d: Dial, flash: Flash, ms: number | null): void {
		this.clearFlash(d);
		d.flash = flash;
		if (ms != null) {
			d.flashTimer = setTimeout(() => {
				d.flashTimer = null;
				d.flash = null;
				void this.draw(id);
			}, ms);
		}
		void this.draw(id);
	}

	private clearFlash(d: Dial): void {
		if (d.flashTimer) clearTimeout(d.flashTimer);
		d.flashTimer = null;
		d.flash = null;
	}

	private async draw(id: string): Promise<void> {
		const d = this.dials.get(id);
		if (!d) return;
		const items = this.items(d);
		const view = items ? d.cursor.view(items, keyOf) : { item: null, index: 0, count: 0 };
		const feedback = ticketFeedback({
			...view,
			project: d.project === ALL ? "All" : d.project,
			armed: view.item != null && d.guard.armed(Date.now()) === view.item.key,
			flash: d.flash,
			problem: this.ctx.service.problem,
			loaded: items != null,
		});
		const key = JSON.stringify(feedback);
		if (key === d.last) return;
		d.last = key;
		await d.action.setFeedback(feedback);
	}
}
