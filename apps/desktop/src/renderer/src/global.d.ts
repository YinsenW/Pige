import type { PigeDesktopApi } from "@pige/contracts";

declare global {
  interface Window {
    pige: PigeDesktopApi;
  }
}

export {};
