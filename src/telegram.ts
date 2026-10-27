type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  disableVerticalSwipes?(): void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export const telegram = window.Telegram?.WebApp;
