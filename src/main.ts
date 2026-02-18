import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface BidirectionalSettings {
	enabled: boolean;
	confirmBeforeUpdate: boolean;
}

const DEFAULT_SETTINGS: BidirectionalSettings = {
	enabled: true,
	confirmBeforeUpdate: false,
};

export default class BidirectionalPlugin extends Plugin {
	settings: BidirectionalSettings;

	async onload() {
		await this.loadSettings();

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.handleMetadataChange(file);
			})
		);

		this.addSettingTab(new BidirectionalSettingTab(this.app, this));
	}

	async handleMetadataChange(file: TFile) {
		if (!this.settings.enabled) return;

		const cache = this.app.metadataCache.getFileCache(file);
		const supersedes = cache?.frontmatter?.supersedes;
		if (!supersedes || typeof supersedes !== "string") return;

		// Parse wikilink: handle both "[[Note]]" and [[Note]]
		const linkMatch = supersedes.match(/\[\[([^\]]+)\]\]/);
		if (!linkMatch) return;

		const linkTarget = linkMatch[1];

		// Resolve to a TFile
		const targetFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
		if (!targetFile) {
			new Notice(`Bidirectional: "${linkTarget}" not found in vault`);
			return;
		}

		// Check if target already has the correct superseded_by
		const targetCache = this.app.metadataCache.getFileCache(targetFile);
		const existingSupersededBy = targetCache?.frontmatter?.superseded_by;

		if (existingSupersededBy && typeof existingSupersededBy === "string") {
			const existingMatch = existingSupersededBy.match(/\[\[([^\]]+)\]\]/);
			if (existingMatch) {
				const existingTarget = existingMatch[1];
				// Resolve what the existing link points to
				const existingFile = this.app.metadataCache.getFirstLinkpathDest(existingTarget, targetFile.path);

				if (existingFile && existingFile.path === file.path) {
					// Already correct, skip
					return;
				}

				if (existingFile && existingFile.path !== file.path) {
					// Superseded by a DIFFERENT file
					new Notice(
						`Bidirectional: "${targetFile.basename}" is already superseded by "${existingFile.basename}", not updating`
					);
					return;
				}
			}
		}

		// Write the reverse property
		const sourceBasename = file.basename;

		if (this.settings.confirmBeforeUpdate) {
			new ConfirmUpdateModal(this.app, targetFile.basename, sourceBasename, async () => {
				await this.writeSupersededBy(targetFile, sourceBasename);
				new Notice(`Bidirectional: Updated "${targetFile.basename}" as superseded by "${sourceBasename}"`);
			}).open();
		} else {
			await this.writeSupersededBy(targetFile, sourceBasename);
			new Notice(`Bidirectional: Updated "${targetFile.basename}" as superseded by "${sourceBasename}"`);
		}
	}

	async writeSupersededBy(file: TFile, supersedingNote: string) {
		await this.app.vault.process(file, (content) => {
			const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

			const newProps = `superseded_by: "[[${supersedingNote}]]"\nstatus: superseded`;

			if (!fmMatch) {
				// No frontmatter exists, create it
				return `---\n${newProps}\n---\n${content}`;
			}

			const fmBlock = fmMatch[1];
			const lines = fmBlock.split("\n");
			const updatedLines: string[] = [];
			let foundSupersededBy = false;
			let foundStatus = false;

			for (const line of lines) {
				if (line.match(/^superseded_by\s*:/)) {
					updatedLines.push(`superseded_by: "[[${supersedingNote}]]"`);
					foundSupersededBy = true;
				} else if (line.match(/^status\s*:/)) {
					updatedLines.push(`status: superseded`);
					foundStatus = true;
				} else {
					updatedLines.push(line);
				}
			}

			if (!foundSupersededBy) {
				updatedLines.push(`superseded_by: "[[${supersedingNote}]]"`);
			}
			if (!foundStatus) {
				updatedLines.push(`status: superseded`);
			}

			return content.replace(/^---\n[\s\S]*?\n---/, `---\n${updatedLines.join("\n")}\n---`);
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ConfirmUpdateModal extends Modal {
	targetName: string;
	sourceName: string;
	onConfirm: () => void;

	constructor(app: App, targetName: string, sourceName: string, onConfirm: () => void) {
		super(app);
		this.targetName = targetName;
		this.sourceName = sourceName;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("p", {
			text: `Mark "${this.targetName}" as superseded by "${this.sourceName}"?`,
		});
		contentEl.createEl("p", {
			text: "This will set superseded_by and status: superseded on the target file.",
			cls: "mod-warning",
		});

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		buttonContainer.createEl("button", { text: "Confirm", cls: "mod-cta" })
			.addEventListener("click", () => {
				this.close();
				this.onConfirm();
			});

		buttonContainer.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => {
				this.close();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}

class BidirectionalSettingTab extends PluginSettingTab {
	plugin: BidirectionalPlugin;

	constructor(app: App, plugin: BidirectionalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Enable auto-population")
			.setDesc("Automatically populate reverse frontmatter properties when supersedes is set.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Confirm before update")
			.setDesc("Show a confirmation notice before writing to the target file.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.confirmBeforeUpdate)
					.onChange(async (value) => {
						this.plugin.settings.confirmBeforeUpdate = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
