package services

import (
	"fmt"
	"net/smtp"
)

// EmailService handles outbound email delivery.
type EmailService struct{}

// SendMagicLink sends a magic link email to the specified address using the
// provided SMTP configuration.
func (s *EmailService) SendMagicLink(toEmail, token, smtpHost, smtpPort, smtpFrom, smtpUser, smtpPass string) error {
	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	subject := "Your TickClone Magic Link"
	body := fmt.Sprintf("Click the link below to sign in to TickClone:\n\nToken: %s\n\nThis link expires in 15 minutes.", token)

	msg := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=\"utf-8\"\r\n\r\n%s",
		smtpFrom, toEmail, subject, body,
	)

	var auth smtp.Auth
	if smtpUser != "" {
		auth = smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
	}

	if err := smtp.SendMail(addr, auth, smtpFrom, []string{toEmail}, []byte(msg)); err != nil {
		return fmt.Errorf("send magic link email: %w", err)
	}

	return nil
}
