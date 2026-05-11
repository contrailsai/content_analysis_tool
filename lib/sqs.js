import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export function getSqsClient() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error("AWS_REGION must be set.");
  return new SQSClient({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

export async function sendIngestionMessage(bodyObject) {
  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!queueUrl) throw new Error("SQS_QUEUE_URL must be set.");
  const client = getSqsClient();
  await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(bodyObject),
    }),
  );
}
