import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, ViewStateResult, TFile } from 'obsidian';
import OpenAI from 'openai';

interface MyPluginSettings {
    apiKey: string;
    defaultPrompt: string;
    userPrompt: string;
    model: string;
}

interface MyPluginViewState {
    text: string;
    [key: string]: unknown;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    apiKey: '',
    defaultPrompt: 'You are a helpful assistant that provides concise summaries.',
    userPrompt: 'Please analyze this text:',
    model: 'gpt-4'
}

class MyPluginView extends ItemView {
    private openai: OpenAI | null = null;
    private summaryEl: HTMLElement;

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

    async updateSummary() {
        console.log('Updating summary...');
        
        if (!this.openai) {
            console.log('No OpenAI client - missing API key');
            this.summaryEl.setText('Please configure OpenAI API key in settings');
            return;
        }

        const currentFile = this.app.workspace.getActiveFile();
        if (!currentFile) {
            console.log('No active file');
            this.summaryEl.setText('No file is currently open');
            return;
        }

        console.log('Reading file:', currentFile.path);
        const content = await this.app.vault.read(currentFile);
        
        // Get file properties/frontmatter
        const metadata = this.app.metadataCache.getFileCache(currentFile);
        const customPrompt = metadata?.frontmatter?.prompt;
        const customUserPrompt = metadata?.frontmatter?.userPrompt;
        const systemPrompt = customPrompt || this.plugin.settings.defaultPrompt;
        const userPrompt = customUserPrompt || this.plugin.settings.userPrompt;
        
        console.log('Using system prompt:', systemPrompt);
        console.log('Using user prompt:', userPrompt);
        
        try {
            console.log('Calling OpenAI API...');
            this.summaryEl.empty();  // Clear previous content
            this.summaryEl.createDiv({ text: 'Generating summary...' });
            
            // Log content length for debugging
            console.log('Content length:', content.length, 'characters');
            
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

            console.log('Received response from OpenAI');
            const summary = response.choices[0]?.message?.content || 'No summary generated';
            
            // Log if the response was truncated
            if (response.choices[0]?.finish_reason === 'length') {
                console.log('Warning: Response was truncated due to length');
            }
            
            // Update the display with preserved line breaks
            this.summaryEl.empty();
            const summaryDiv = this.summaryEl.createDiv();
            summaryDiv.style.whiteSpace = 'pre-wrap';
            summaryDiv.setText(summary);
        } catch (error) {
            console.error('Error generating summary:', error);
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
                console.log('Socrates command triggered');
                this.activateView();
            }
        });

        // Add settings tab
        this.addSettingTab(new MyPluginSettingTab(this.app, this));

        // Log that plugin has loaded
        console.log('Socrates plugin loaded');
    }

    async onunload() {
        console.log('Unloading Socrates plugin...');
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
        
        console.log('Activating Socrates view');
        
        let leaf = workspace.getLeavesOfType("socrates-view")[0];
        console.log('Existing leaf:', leaf ? 'found' : 'not found');
        
        if (!leaf) {
            console.log('Creating new leaf');
            const newLeaf = workspace.getRightLeaf(false);
            if (newLeaf) {
                console.log('Setting view state');
                await newLeaf.setViewState({
                    type: "socrates-view",
                    active: true,
                });
                leaf = newLeaf;
                console.log('New leaf created and configured');
            } else {
                console.error("Could not create new leaf");
                return;
            }
        }
        
        console.log('Revealing leaf');
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
                .addOption('gpt-4', 'GPT-4')
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

        new Setting(containerEl)
            .setName('User Prompt')
            .setDesc('User prompt prefix (can be overridden in note properties with "userPrompt")')
            .addTextArea(text => text
                .setPlaceholder('Enter user prompt')
                .setValue(this.plugin.settings.userPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.userPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // Style both textareas
        const textareas = containerEl.querySelectorAll('.setting-item textarea') as NodeListOf<HTMLTextAreaElement>;
        textareas.forEach(textarea => {
            textarea.style.width = '100%';
            textarea.style.height = '100px';
        });
    }
} 