"use client";

import { useState } from "react";
import {
  Button,
  Input,
  Label,
  Textarea,
  Select,
  Card,
  Badge,
  Modal,
  Spinner,
  PageHeader,
} from "@/components/ui";
import { validateCallbackRequest, hasCallbackErrors, formatCallbackStatus } from "@zfloat/support";

interface CallbackRequestFormProps {
  tenantId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  onSuccess?: () => void;
  onClose?: () => void;
}

export function CallbackRequestForm({
  tenantId,
  userId,
  userName,
  userEmail,
  userPhone,
  onSuccess,
  onClose,
}: CallbackRequestFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: userName,
    phone: userPhone || "",
    email: userEmail,
    preferredTime: "",
    timezone: "Africa/Nairobi",
    reason: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const timezones = [
    { value: "Africa/Nairobi", label: "Africa/Nairobi (EAT, UTC+3)" },
    { value: "Africa/Lagos", label: "Africa/Lagos (WAT, UTC+1)" },
    { value: "Africa/Johannesburg", label: "Africa/Johannesburg (SAST, UTC+2)" },
    { value: "UTC", label: "UTC (UTC+0)" },
  ];

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationErrors = validateCallbackRequest(formData);
    if (hasCallbackErrors(validationErrors)) {
      setErrors(validationErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/support/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          userId,
          name: formData.name,
          phone: formData.phone,
          email: formData.email || undefined,
          preferredTime: formData.preferredTime,
          timezone: formData.timezone,
          reason: formData.reason || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to request callback");
      }

      setSuccess(true);
      setFormData({
        name: userName,
        phone: userPhone || "",
        email: userEmail,
        preferredTime: "",
        timezone: "Africa/Nairobi",
        reason: "",
      });
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request callback");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSuccess(false);
    setError(null);
    setErrors({});
    onClose?.();
  };

  // Generate min datetime for the datetime-local input (now + 15 minutes)
  const minDateTime = new Date(Date.now() + 15 * 60 * 1000).toISOString().slice(0, 16);

  return (
    <>
      <Button onClick={() => setIsOpen(true)} variant="secondary">
        <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
        Request Callback
      </Button>

      <Modal open={isOpen} onClose={handleClose} title="Request a Callback" size="lg">
        {success ? (
          <div className="space-y-4 text-center py-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success text-2xl">
              ✓
            </div>
            <h3 className="text-lg font-semibold">Callback Requested!</h3>
            <p className="text-muted">
              We'll call you at <strong>{formData.phone}</strong> on{" "}
              <strong>{new Date(formData.preferredTime).toLocaleString()}</strong>.
              Our team will reach out within the scheduled window.
            </p>
            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded bg-danger/10 border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}

            <div>
              <Label htmlFor="name">Your Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                required
                error={!!errors.name}
              />
              {errors.name && <p className="mt-1 text-sm text-danger">{errors.name}</p>}
            </div>

            <div>
              <Label htmlFor="phone">Phone Number *</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange("phone", e.target.value)}
                placeholder="+254 7XX XXX XXX"
                required
                error={!!errors.phone}
              />
              {errors.phone && <p className="mt-1 text-sm text-danger">{errors.phone}</p>}
            </div>

            <div>
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange("email", e.target.value)}
                placeholder="you@example.com"
                error={!!errors.email}
              />
              {errors.email && <p className="mt-1 text-sm text-danger">{errors.email}</p>}
            </div>

            <div>
              <Label htmlFor="preferredTime">Preferred Callback Time *</Label>
              <Input
                id="preferredTime"
                type="datetime-local"
                value={formData.preferredTime}
                onChange={(e) => handleChange("preferredTime", e.target.value)}
                min={minDateTime}
                required
                error={!!errors.preferredTime}
              />
              {errors.preferredTime && <p className="mt-1 text-sm text-danger">{errors.preferredTime}</p>}
              <p className="mt-1 text-xs text-muted">
                We'll call within 30 minutes of your selected time.
              </p>
            </div>

            <div>
              <Label htmlFor="timezone">Timezone *</Label>
              <Select
                id="timezone"
                value={formData.timezone}
                onChange={(e) => handleChange("timezone", e.target.value)}
                error={!!errors.timezone}
              >
                {timezones.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </Select>
              {errors.timezone && <p className="mt-1 text-sm text-danger">{errors.timezone}</p>}
            </div>

            <div>
              <Label htmlFor="reason">Reason for Callback (optional)</Label>
              <Textarea
                id="reason"
                value={formData.reason}
                onChange={(e) => handleChange("reason", e.target.value)}
                rows={3}
                placeholder="Briefly describe what you need help with..."
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="secondary" onClick={handleClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Spinner className="h-4 w-4" /> : "Request Callback"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}