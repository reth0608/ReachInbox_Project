export type EmailJobStatus = 'scheduled' | 'processing' | 'sent' | 'failed';

export interface Campaign {
  id: string;
  userId: string;
  subject: string;
  body: string;
  senderId: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  startTime: string;
  createdAt: string;
}

export interface EmailJob {
  id: string;
  campaignId: string;
  campaignSubject: string;
  recipientEmail: string;
  status: EmailJobStatus;
  scheduledTime: string;
  sentAt: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface Sender {
  id: string;
  name: string;
  smtpHost: string;
}

export interface CreateCampaignInput {
  subject: string;
  body: string;
  senderId: string;
  startTime: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  recipients: string[];
}

export interface CreateCampaignResponse {
  campaign: Campaign;
  jobs: Array<{ id: string; recipientEmail: string; status: EmailJobStatus; scheduledTime: string }>;
  recipientCount: number;
}
