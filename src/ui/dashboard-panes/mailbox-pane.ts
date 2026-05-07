import type { RunUiSnapshot } from "../snapshot-types.ts";

export function renderMailboxPane(snapshot: RunUiSnapshot | undefined): string[] {
	if (!snapshot) return ["Mailbox pane: snapshot unavailable"];
	const mailbox = snapshot.mailbox;
	const approx = mailbox.approximate ? " · approximate (tail)" : "";
	const lines: string[] = [
		`Mailbox pane: inbox unread=${mailbox.inboxUnread} · outbox pending=${mailbox.outboxPending} · attention=${mailbox.needsAttention}${approx}`,
	];
	// Kind-separated breakdown
	const kindParts: string[] = [];
	const steer = mailbox.steerUnread ?? 0;
	const followUp = mailbox.followUpUnread ?? 0;
	const response = mailbox.responseUnread ?? 0;
	const message = mailbox.messageUnread ?? 0;
	if (steer > 0) kindParts.push(`steer=${steer}`);
	if (followUp > 0) kindParts.push(`follow-up=${followUp}`);
	if (response > 0) kindParts.push(`response=${response}`);
	if (message > 0) kindParts.push(`message=${message}`);
	if (kindParts.length > 0) {
		lines.push(`  Breakdown: ${kindParts.join(" · ")}`);
		if (steer > 0) {
			lines.push("  ⚠ Urgent: steering messages require immediate attention.");
		}
		if (followUp > 0) {
			lines.push(`  📋 ${followUp} follow-up(s) pending review.`);
		}
	}
	if (mailbox.needsAttention > 0) {
		lines.push("Needs attention: press Enter for detail · A ack · N nudge · C compose · X ack all.");
	} else {
		lines.push("No mailbox items need attention. Press Enter for detail or C compose.");
	}
	return lines;
}
