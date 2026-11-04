import "server-only";

import {
  normalizeHttpBaseUrl,
  normalizeSmsRecipient,
  type ContinueOnPhoneConfig,
} from "@/lib/integrations/continue-on-phone";
import {
  getActiveTextTransportProvider,
  getTextTransportFromNumber,
  isTextAgentEnabled,
} from "@/lib/integrations/text-transport";

export function getContinueOnPhoneConfig(): ContinueOnPhoneConfig {
  const provider = getActiveTextTransportProvider();
  const smsNumber = normalizeSmsRecipient(getTextTransportFromNumber(provider));

  return {
    agentEnabled: isTextAgentEnabled(provider) && Boolean(smsNumber),
    challengeEndpoint: "/api/kinfolk/continue-on-phone/challenge",
    publicHandoffBaseUrl: normalizeHttpBaseUrl(
      process.env.NEXT_PUBLIC_KINFOLK_BASE_URL,
    ),
  };
}
