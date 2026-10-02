"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Button,
  Input,
  Textarea,
  Label,
  Card,
  Badge,
  Spinner,
  Modal,
  ScrollArea,
  Avatar,
} from "@/components/ui";

interface ChatMessage {
  id: string;
  body: string;
  authorIsAgent: boolean;
  authorName: string;
  createdAt: string;
}

interface ChatSession {
  id: string;
  status: string;
  subject: string | null;
  agentId: string | null;
  agentName: string | null;
  unreadCount: number;
}

interface ChatWidgetProps {
  tenantId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  onMinimize?: () => void;
  onClose?: () => void;
}

export function ChatWidget({
  tenantId,
  userId,
  userName,
  userEmail,
  userPhone,
  onMinimize,
  onClose,
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load existing session or create new one
  const loadSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/chat/session?tenantId=${tenantId}&userId=${userId}`);
      const data = await res.json();
      if (data.data?.session) {
        setSession(data.data.session);
        if (data.data.messages) {
          setMessages(data.data.messages);
          setUnreadCount(data.data.messages.filter((m: ChatMessage) => m.authorIsAgent && !m.read).length);
        }
      }
    } catch (err) {
      setError("Failed to load chat session");
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, userId]);

  // Create new chat session
  const createSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/support/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, userId, userName, userEmail, userPhone }),
      });
      const data = await res.json();
      if (data.data?.session) {
        setSession(data.data.session);
        setMessages([]);
        setUnreadCount(0);
      }
    } catch (err) {
      setError("Failed to start chat");
    } finally {
      setIsLoading(false);
    }
  }, [tenantId, userId, userName, userEmail, userPhone]);

  // Send message
  const sendMessage = useCallback(async (body: string) => {
    if (!session || isSending || !body.trim()) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/support/chat/session/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      const data = await res.json();
      if (data.data?.message) {
        setMessages((prev) => [...prev, data.data.message]);
        setNewMessage("");
      }
    } catch (err) {
      setError("Failed to send message");
    } finally {
      setIsSending(false);
    }
  }, [session, isSending]);

  // Poll for new messages
  const pollMessages = useCallback(async () => {
    if (!session || session.status === "ENDED") return;

    try {
      const res = await fetch(`/api/support/chat/session/${session.id}/messages`);
      const data = await res.json();
      if (data.data?.messages) {
        const newMessages = data.data.messages;
        setMessages(newMessages);
        // Count unread agent messages
        const unread = newMessages.filter((m: ChatMessage) => m.authorIsAgent && !m.read).length;
        setUnreadCount(unread);
      }
    } catch (err) {
      // Silent fail for polling
    }
  }, [session]);

  // Start polling when session exists
  useEffect(() => {
    if (session) {
      pollMessages();
      pollIntervalRef.current = setInterval(pollMessages, 3000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [session, pollMessages]);

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(newMessage);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    onMinimize?.();
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
    onClose?.();
  };

  const handleExpand = () => {
    setIsMinimized(false);
    setIsOpen(true);
  };

  // If minimized, show floating button
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={handleExpand}
          variant="primary"
          className="rounded-full px-4 py-3 shadow-lg flex items-center gap-2"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="hidden sm:inline">Chat</span>
          {unreadCount > 0 && (
            <Badge tone="danger" className="ml-1">{unreadCount}</Badge>
          )}
        </Button>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-md">
      <Card className="h-[500px] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-borderline bg-surface/60">
          <div className="flex items-center gap-3">
            <Avatar
              src={session?.agentId ? undefined : undefined}
              fallback={session?.agentName?.[0] || "💬"}
              size="sm"
            />
            <div>
              <p className="font-medium text-sm">
                {session?.agentName ? `Chatting with ${session.agentName}` : "Support Chat"}
              </p>
              <p className="text-xs text-muted">
                {session ? formatChatStatus(session.status) : "Connecting..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {session?.status === "WAITING" && (
              <Badge tone="warning" className="text-xs">
                Queue: {session.agentId ? "Connecting..." : "Waiting for agent"}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={handleMinimize} aria-label="Minimize">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12H3" />
              </svg>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClose} aria-label="Close">
              ✕
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 p-4 space-y-4 overflow-y-auto">
          {isLoading && !session ? (
            <div className="flex items-center justify-center h-full">
              <Spinner className="h-8 w-8" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center text-muted">
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.authorIsAgent ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                    msg.authorIsAgent
                      ? "bg-surface text-ink rounded-bl-sm"
                      : "bg-primary text-white rounded-br-sm"
                  }`}
                >
                  <p className="text-sm">{msg.body}</p>
                  <p className={`text-xs mt-1 ${msg.authorIsAgent ? "text-muted/60" : "text-primary/70"}`}>
                    {msg.authorIsAgent ? (msg.authorName || "Agent") : "You"}
                    · {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-danger/10 border-t border-danger/20">
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-borderline bg-white">
          <div className="flex gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={session?.status === "WAITING" ? "Waiting for agent..." : "Type a message..."}
              disabled={session?.status === "ENDED" || isSending}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={!newMessage.trim() || session?.status === "ENDED" || isSending}
              size="md"
            >
              {isSending ? <Spinner className="h-4 w-4" /> : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function formatChatStatus(status: string): string {
  const map: Record<string, string> = {
    WAITING: "Waiting for agent...",
    ACTIVE: "Agent is online",
    TRANSFERRED: "Transferring...",
    ENDED: "Chat ended",
  };
  return map[status] ?? status;
}

// Floating chat button component
export function ChatButton({
  tenantId,
  userId,
  userName,
  userEmail,
  userPhone,
  unreadCount = 0,
}: ChatWidgetProps & { unreadCount?: number }) {
  const [showWidget, setShowWidget] = useState(false);

  return (
    <>
      <Button
        onClick={() => setShowWidget(true)}
        variant="primary"
        className="fixed bottom-6 right-6 z-50 rounded-full px-4 py-3 shadow-lg flex items-center gap-2"
        aria-label="Open support chat"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="hidden sm:inline">Support</span>
        {unreadCount > 0 && (
          <Badge tone="danger" className="ml-1">{unreadCount}</Badge>
        )}
      </Button>

      {showWidget && (
        <ChatWidget
          tenantId={tenantId}
          userId={userId}
          userName={userName}
          userEmail={userEmail}
          userPhone={userPhone}
          onClose={() => setShowWidget(false)}
        />
      )}
    </>
  );
}