import { logger } from "@/common/logger";
import { ApiKeyManager, ApiKeyRecord } from "@/models/api-keys";
import { AllChainsChannel } from "@/pubsub/channels";

export class ApiKeyCreatedAllChainsEvent {
  public static async handleEvent(message: string) {
    const parsedMessage = JSON.parse(message) as ApiKeyRecord;
    const manager = new ApiKeyManager();

    await manager.create(parsedMessage);

    logger.info(AllChainsChannel.ApiKeyCreated, `Reloaded key=${parsedMessage.key}`);
  }
}
