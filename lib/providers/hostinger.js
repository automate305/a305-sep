function smtpHost(brandSlug) {
  return process.env[`SMTP_HOST_${brandSlug}`] || 'smtp.hostinger.com';
}

function smtpPort(brandSlug) {
  return parseInt(process.env[`SMTP_PORT_${brandSlug}`] || '465', 10);
}

function imapHost(brandSlug) {
  return process.env[`IMAP_HOST_${brandSlug}`] || 'imap.hostinger.com';
}

function imapPort(brandSlug) {
  return parseInt(process.env[`IMAP_PORT_${brandSlug}`] || '993', 10);
}

function smtpSecure(brandSlug) {
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
  spfInclude: '_spf.hostinger.com',
  dkimSelector: 'default',
  getSmtpAuth,
  prerequisites: [],
};
