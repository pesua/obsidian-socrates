import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, ViewStateResult, TFile } from 'obsidian';
import OpenAI from 'openai';

interface MyPluginSettings {
    apiKey: string;
    defaultPrompt: string;
    model: string;
}

interface MyPluginViewState {
    text: string;
    [key: string]: unknown;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    apiKey: '',
    defaultPrompt: 'You are a helpful assistant that provides concise summaries.',
    model: 'gpt-4o'
}

class MyPluginView extends ItemView {
    private openai: OpenAI | null = null;
    private summaryEl: HTMLElement;
    private fileSizes: Map<string, number> = new Map();

    constructor(leaf: WorkspaceLeaf, private plugin: MyPlugin) {
        super(leaf);
        if (plugin.settings.apiKey) {
            this.openai = new OpenAI({
                apiKey: plugin.settings.apiKey,
                dangerouslyAllowBrowser: true
            });
        }
    }

    getViewType(): string {
        return "socrates-view";
    }

    getDisplayText(): string {
        return "Socrates View";
    }

    private calculateIntensity(size: number): number {
        // Define size thresholds for different intensities
        const thresholds = [0, 100, 500, 1000]; // bytes
        for (let i = thresholds.length - 1; i >= 0; i--) {
            if (size >= thresholds[i]) return i;
        }
        return 0;
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        
        // Create header container for title and refresh button
        const headerEl = container.createEl("div", { cls: "socrates-header" });
        
        // Add title
        headerEl.createEl("h4", { 
            text: "Socrates Panel",
            cls: "socrates-title"
        });
        
        // Add refresh button
        const refreshButton = headerEl.createEl("button", {
            text: "Refresh",
            cls: "socrates-refresh-button"
        });
        refreshButton.addEventListener("click", () => {
            this.updateSummary();
        });

        // Add activity widget with title
        const activityEl = container.createEl("div", { cls: "socrates-activity" });
        activityEl.createEl("div", { text: "Activity", cls: "activity-title" });
        
        // Create grid container
        const gridEl = activityEl.createEl("div", { cls: "activity-grid" });
        
        // Create grid of boxes (7 rows, 12 columns)
        for (let row = 0; row < 7; row++) {
            for (let col = 0; col < 12; col++) {
                const box = gridEl.createEl("div", { cls: "activity-box" });
            }
        }
        
        // Create summary element
        this.summaryEl = container.createEl("div", { cls: "socrates-summary" });
        
        // Initial summary
        await this.updateSummary();
        
        // Listen for file changes
        this.registerEvent(
            this.app.workspace.on('file-open', () => {
                this.updateSummary();
            })
        );
    }

    async getUserPromptFromFile(): Promise<string> {
        try {
            const instructionsFile = this.app.vault.getAbstractFileByPath('Socrates/Instructions.md');
            
            if (instructionsFile instanceof TFile) {
                const content = await this.app.vault.read(instructionsFile);
                return content;
            } else {
                // If file doesn't exist, create it with default content
                const defaultInstructions = 'Please analyze this text:';
                await this.app.vault.createFolder('Socrates');
                await this.app.vault.create('Socrates/Instructions.md', defaultInstructions);
                return defaultInstructions;
            }
        } catch (error) {
            return 'Please analyze this text:';
        }
    }

    async updateSummary() {
        if (!this.openai) {
            this.summaryEl.setText('Please configure OpenAI API key in settings');
            return;
        }

        // Scan Щоденник folder
        const diaryFolder = this.app.vault.getAbstractFileByPath('Щоденник');
        this.fileSizes.clear(); // Clear previous data

        if (diaryFolder instanceof TFile) {
            // Handle file case
        } else if (diaryFolder) {
            // Get all files in the folder
            const files = this.app.vault.getFiles().filter(file => 
                file.path.startsWith('Щоденник/') && 
                file.extension === 'md'
            );

            // Get size of each file
            for (const file of files) {
                const content = await this.app.vault.read(file);
                const date = file.path.replace('Щоденник/', '').replace('.md', '');
                this.fileSizes.set(date, content.length);
            }
            // Update activity grid
            const gridEl = this.containerEl.querySelector('.activity-grid');
            if (gridEl) {
                const boxes = gridEl.querySelectorAll('.activity-box');
                boxes.forEach((box, index) => {
                    const currentWeekDayIndex = new Date().getDay();
                    const column = index % 12
                    const row = Math.floor(index / 12)
                    const daysToBox = currentWeekDayIndex - 1 + (12 - column -2) * 7 + 7 - row;

                    const date = new Date();
                    date.setDate(date.getDate() - daysToBox);
                    const size = this.fileSizes.get(date.toISOString().split('T')[0]) || 0;
                    const intensity = this.calculateIntensity(size);
                    box.className = `activity-box intensity-${intensity}`;
                    if (daysToBox === 0) {
                        box.addClass('current-day');
                    }
                    box.setAttribute('title', `${date.toISOString().split('T')[0]}: ${size} bytes`);
                });
            }
        }

        // Rest of the existing updateSummary code...
        const currentFile = this.app.workspace.getActiveFile();
        if (!currentFile) {
            this.summaryEl.setText('No file is currently open');
            return;
        }

        const content = await this.app.vault.read(currentFile);
        
        // Get file properties/frontmatter
        const metadata = this.app.metadataCache.getFileCache(currentFile);
        const customPrompt = metadata?.frontmatter?.prompt;
        const systemPrompt = customPrompt || this.plugin.settings.defaultPrompt;
        
        try {
            this.summaryEl.empty();  // Clear previous content
            this.summaryEl.createDiv({ text: 'Generating summary...' });
            
            // Get user prompt from file
            const userPrompt = await this.getUserPromptFromFile();
            
            const response = await this.openai.chat.completions.create({
                model: this.plugin.settings.model,
                messages: [{
                    role: "system",
                    content: systemPrompt
                }, {
                    role: "user",
                    content: `${userPrompt} ${content}`
                }],
                max_tokens: 1000,
                temperature: 0.7
            });

            const summary = response.choices[0]?.message?.content || 'No summary generated';
            
            // Update the display with preserved line breaks
            this.summaryEl.empty();
            const summaryDiv = this.summaryEl.createDiv();
            summaryDiv.style.whiteSpace = 'pre-wrap';
            summaryDiv.setText(summary);
        } catch (error) {
            this.summaryEl.empty();
            this.summaryEl.createDiv({ text: 'Error generating summary: ' + (error as Error).message });
        }
    }

    async onClose() {
        // Nothing to clean up
    }

    getState(): Record<string, unknown> {
        return {
            text: "example state"
        };
    }

    async setState(state: MyPluginViewState, result: ViewStateResult): Promise<void> {
        // Handle state changes if needed
    }

    updateOpenAIClient(apiKey: string) {
        if (apiKey) {
            this.openai = new OpenAI({
                apiKey: apiKey,
                dangerouslyAllowBrowser: true
            });
        } else {
            this.openai = null;
        }
        this.updateSummary();
    }
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;
    private view: MyPluginView;

    async onload() {
        await this.loadSettings();

        // Register view
        this.registerView(
            "socrates-view",
            (leaf) => (this.view = new MyPluginView(leaf, this))
        );

        // Update command ID to match plugin
        this.addCommand({
            id: 'show-socrates-view',
            name: 'Show Socrates Panel',
            callback: () => {
                this.activateView();
            }
        });

        // Add settings tab
        this.addSettingTab(new MyPluginSettingTab(this.app, this));
    }

    async onunload() {
        await this.app.workspace.detachLeavesOfType("socrates-view");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        
        let leaf = workspace.getLeavesOfType("socrates-view")[0];
        
        if (!leaf) {
            const newLeaf = workspace.getRightLeaf(false);
            if (newLeaf) {
                await newLeaf.setViewState({
                    type: "socrates-view",
                    active: true,
                });
                leaf = newLeaf;
            } else {
                return;
            }
        }
        
        workspace.revealLeaf(leaf);
    }

    public updateOpenAIClient(apiKey: string) {
        if (this.view) {
            this.view.updateOpenAIClient(apiKey);
        }
    }
}

class MyPluginSettingTab extends PluginSettingTab {
    plugin: MyPlugin;

    constructor(app: App, plugin: MyPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        
        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('Enter your OpenAI API key')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateOpenAIClient(value);
                }));

        new Setting(containerEl)
            .setName('Model')
            .setDesc('Select OpenAI model to use')
            .addDropdown(dropdown => dropdown
                .addOption('gpt-4o', 'GPT-4o')
                .addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('System Prompt')
            .setDesc('System prompt for OpenAI (can be overridden in note properties with "prompt")')
            .addTextArea(text => text
                .setPlaceholder('Enter system prompt')
                .setValue(this.plugin.settings.defaultPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.defaultPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // Style textarea
        const textarea = containerEl.querySelector('.setting-item textarea') as HTMLTextAreaElement;
        if (textarea) {
            textarea.style.width = '100%';
            textarea.style.height = '100px';
        }
    }
} 