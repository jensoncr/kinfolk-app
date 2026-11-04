export const GROUP_PREFERENCES_SUBMIT_ERROR = "Unable to create group.";

export function groupPreferencesSubmitErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return GROUP_PREFERENCES_SUBMIT_ERROR;
}
