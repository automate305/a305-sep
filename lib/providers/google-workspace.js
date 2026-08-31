function smtpHost(brandSlug) {
  return process.env[`SMTP_HOST_${brandSlug}`] || 'smtp.gmail.com';
}

function smtpPort(brandSlug) {
  return parseInt(process.env[`SMTP_PORT_${brandSlug}`] || '587', 10);
}

function imapHost(brandSlug) {
  return process.env[`IMAP_HOST_${brandSlug}`] || 'imap.gmail.com';
}

function imapPort(brandSlug) {
  return parseInt(process.env[`IMAP_PORT_${brandSlug}`] || '993', 10);
}

function smtpSecure(brandSlug) {
  // Port 587 uses STARTTLS (upgrade after connect), not implicit TLS
  return smtpPort(brandSlug) === 465;
}

function getSmtpAuth(mailboxAddress) {
  const localPart = mailboxAddress.split('@')[0];
  const envKey = `SMTP_PASS_${localPart.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return { user: mailboxAddress, pass: process.env[envKey] };
}

export default {
  smtpHost,
  smtpPort,
  smtpSecure,
  imapHost,
  imapPort,
  spfInclude: '_spf.google.com',
  dkimSelector: 'google',
  getSmtpAuth,
  prerequisites: ['2-Step Verification', 'IMAP enabled'],
};
