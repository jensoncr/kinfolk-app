export const ENRICH_WELCOME_SEEN_KEY = "kinfolk:enrich-welcome-seen";
export const CONVERSATION_WELCOME_SEEN_KEY = "kinfolk:conversation-welcome-seen";

export function resetWelcomeModalSeenState() {
  try {
    localStorage.removeItem(ENRICH_WELCOME_SEEN_KEY);
    localStorage.removeItem(CONVERSATION_WELCOME_SEEN_KEY);
  } catch {
    // Storage blocked — preview links still work for the current session.
  }
}

export function shouldResetWelcomeModals() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("resetWelcome") === "1";
  } catch {
    return false;
  }
}

export function shouldForceEnrichmentWelcome() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("enrichWelcome") === "1" || params.get("showEnrichWelcome") === "1";
  } catch {
    return false;
  }
}

export function shouldForceConversationWelcome() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("welcome") === "1" || params.get("showWelcome") === "1";
  } catch {
    return false;
  }
}
