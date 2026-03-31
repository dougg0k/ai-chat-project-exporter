import type { ProviderName, ThemeMode } from "./types";

export interface UiTheme {
	appBackground: string;
	panelBackground: string;
	panelBorder: string;
	text: string;
	mutedText: string;
	buttonBackground: string;
	buttonText: string;
	buttonBorder: string;
	buttonActiveBackground: string;
	buttonActiveText: string;
	floatingButtonBackground: string;
	floatingButtonText: string;
	floatingButtonBorder: string;
	floatingButtonOpenBackground: string;
	floatingButtonOpenText: string;
	floatingButtonOpenBorder: string;
	shadow: string;
	errorText: string;
	accent: string;
}

const lightBase: UiTheme = {
	appBackground: "#f3f4f6",
	panelBackground: "#ffffff",
	panelBorder: "1px solid rgba(15,23,42,0.08)",
	text: "#111827",
	mutedText: "#667085",
	buttonBackground: "#ffffff",
	buttonText: "#111827",
	buttonBorder: "1px solid rgba(15,23,42,0.10)",
	buttonActiveBackground: "#475467",
	buttonActiveText: "#ffffff",
	floatingButtonBackground: "#ffffff",
	floatingButtonText: "#111827",
	floatingButtonBorder: "1px solid rgba(15,23,42,0.12)",
	floatingButtonOpenBackground: "#475467",
	floatingButtonOpenText: "#ffffff",
	floatingButtonOpenBorder: "1px solid #475467",
	shadow: "0 16px 36px rgba(15,23,42,0.12)",
	errorText: "#c2410c",
	accent: "#475467",
};

const darkDefault: UiTheme = {
	appBackground: "#16181d",
	panelBackground: "#1f2329",
	panelBorder: "1px solid rgba(255,255,255,0.08)",
	text: "#f3f4f6",
	mutedText: "#b6beca",
	buttonBackground: "#272c33",
	buttonText: "#f5f7fa",
	buttonBorder: "1px solid rgba(255,255,255,0.09)",
	buttonActiveBackground: "#5b7fff",
	buttonActiveText: "#f8faff",
	floatingButtonBackground: "#23272e",
	floatingButtonText: "#f5f7fa",
	floatingButtonBorder: "1px solid rgba(255,255,255,0.10)",
	floatingButtonOpenBackground: "#5b7fff",
	floatingButtonOpenText: "#f8faff",
	floatingButtonOpenBorder: "1px solid #5b7fff",
	shadow: "0 18px 40px rgba(0,0,0,0.34)",
	errorText: "#f3b29b",
	accent: "#5b7fff",
};

const lightByProvider: Record<ProviderName, Partial<UiTheme>> = {
	chatgpt: {
		buttonActiveBackground: "#4f7cff",
		floatingButtonOpenBackground: "#4f7cff",
		floatingButtonOpenBorder: "1px solid #4f7cff",
		accent: "#4f7cff",
	},
	claude: {
		appBackground: "#f6f2ec",
		buttonActiveBackground: "#b9733d",
		floatingButtonOpenBackground: "#b9733d",
		floatingButtonOpenBorder: "1px solid #b9733d",
		errorText: "#b45309",
		accent: "#b9733d",
	},
};

const darkByProvider: Record<ProviderName, Partial<UiTheme>> = {
	chatgpt: {
		appBackground: "#1b1d1f",
		panelBackground: "#24272b",
		panelBorder: "1px solid rgba(255,255,255,0.07)",
		text: "#f2f4f7",
		mutedText: "#b4bcc8",
		buttonBackground: "#2b3136",
		buttonText: "#f3f6f9",
		buttonBorder: "1px solid rgba(255,255,255,0.08)",
		buttonActiveBackground: "#4f7cff",
		buttonActiveText: "#f7faff",
		floatingButtonBackground: "#262b30",
		floatingButtonText: "#f3f6f9",
		floatingButtonBorder: "1px solid rgba(255,255,255,0.09)",
		floatingButtonOpenBackground: "#4f7cff",
		floatingButtonOpenText: "#f7faff",
		floatingButtonOpenBorder: "1px solid #4f7cff",
		shadow: "0 18px 42px rgba(0,0,0,0.36)",
		accent: "#4f7cff",
	},
	claude: {
		appBackground: "#191613",
		panelBackground: "#221d19",
		panelBorder: "1px solid rgba(248,232,214,0.09)",
		text: "#f3ece4",
		mutedText: "#c7baa9",
		buttonBackground: "#2b241f",
		buttonText: "#f6efe8",
		buttonBorder: "1px solid rgba(248,232,214,0.11)",
		buttonActiveBackground: "#b9733d",
		buttonActiveText: "#1d120b",
		floatingButtonBackground: "#261f1a",
		floatingButtonText: "#f6efe8",
		floatingButtonBorder: "1px solid rgba(248,232,214,0.12)",
		floatingButtonOpenBackground: "#b9733d",
		floatingButtonOpenText: "#1d120b",
		floatingButtonOpenBorder: "1px solid #b9733d",
		shadow: "0 18px 42px rgba(0,0,0,0.34)",
		errorText: "#f4b08a",
		accent: "#b9733d",
	},
};

export function getUiTheme(
	mode: ThemeMode,
	provider?: ProviderName | null,
): UiTheme {
	if (mode === "light") {
		return provider
			? { ...lightBase, ...lightByProvider[provider] }
			: lightBase;
	}

	return provider
		? { ...darkDefault, ...darkByProvider[provider] }
		: darkDefault;
}
