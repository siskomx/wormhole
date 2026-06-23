export type Notification = {
  url: string;
  message: string;
};

export async function sendNotification(notification: Notification): Promise<void> {
  await fetch(notification.url, {
    method: "POST",
    body: JSON.stringify({ message: notification.message }),
  });
}
