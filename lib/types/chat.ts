// 🚀 UPDATED MESSAGE INTERFACE WITHIN YOUR CHAT API LAYER FILE
export interface Participant {
  id: string; // matches your dynamic dataset type allocations
  firstName?: string;
  lastName?: string;
  role: string;
}

export interface Thread {
  id: string;
  type: string;
  subject: string;
  status: string;
  lastMessage?: string;
  updatedAt: string;
  createdAt: string;
  participants: Participant[];
  unreadCount: number;
  lastSenderName: string | null;
}

// 🚀 RECONFIGURED: Expresses nested relational columns populated by your Prisma backend controller query
export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  senderRole: string;
  content: string;
  isRead: boolean;
  createdAt: string;
  sender?: {
    id: number | string;
    firstName: string;
    lastName: string;
    role: string;
  };
  thread?: {
    id: string;
    subject: string;
    participants: Participant[];
  };
}
