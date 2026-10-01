// The Jira connection block, shared by every action's settings panel.
// Site and email are global settings; the token goes to the plugin, which keeps it
// in the macOS Keychain, so it never lands in Stream Deck's settings files.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const block = document.createElement("div");
	block.innerHTML = `
		<sdpi-item label="Jira site">
			<sdpi-textfield global setting="site" placeholder="example.atlassian.net"></sdpi-textfield>
		</sdpi-item>
		<sdpi-item label="Email">
			<sdpi-textfield global setting="email" placeholder="you@example.com"></sdpi-textfield>
		</sdpi-item>
		<sdpi-item label="API token">
			<input id="jira-token" type="password" placeholder="Paste a token, then Save" autocomplete="off"
				style="flex:1;min-width:0;background:#3d3d3d;color:#d8d8d8;border:none;border-radius:3px;padding:4px 6px;font-size:9pt" />
			<sdpi-button id="jira-save">Save</sdpi-button>
		</sdpi-item>
		<sdpi-item>
			<p id="jira-status" style="margin:0;font-size:9pt;opacity:.8">Checking…</p>
		</sdpi-item>
		<sdpi-item>
			<p style="margin:0;font-size:9pt;opacity:.6">Shared by every action. Make a token at
			id.atlassian.com/manage-profile/security/api-tokens. It's stored in your Keychain.</p>
		</sdpi-item>`;
	document.body.append(block);

	const status = document.getElementById("jira-status");
	const input = document.getElementById("jira-token");
	client.sendToPropertyInspector.subscribe((msg) => {
		const p = msg.payload || {};
		if (p.event !== "tokenStatus") return;
		status.textContent = p.text;
		status.style.color = p.ok ? "#30D158" : "#FF9F0A";
	});
	document.getElementById("jira-save").addEventListener("click", () => {
		const token = input.value.trim();
		if (!token) return;
		status.textContent = "Saving…";
		status.style.color = "";
		client.send("sendToPlugin", { event: "saveToken", token });
		input.value = "";
	});
	// Re-check after the site or email changes (sdpi saves them after a short debounce).
	let timer;
	client.didReceiveGlobalSettings.subscribe(() => {
		clearTimeout(timer);
		timer = setTimeout(() => client.send("sendToPlugin", { event: "tokenStatus" }), 800);
	});
	client.send("sendToPlugin", { event: "tokenStatus" });
})();
