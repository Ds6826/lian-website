const { neon } = require('@neondatabase/serverless');
const nodemailer = require('nodemailer');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const requiredFields = ['work_email', 'company', 'role', 'company_website', 'agent_workflow', 'changing_facts', 'audit_requirement', 'current_stage', 'preferred_track', 'deployment_requirement'];
const allowedStages = new Set(['Prototype', 'Pilot', 'Production']);
const allowedTracks = new Set(['Implementation', 'Evaluation', 'Unsure']);
const allowedDeployments = new Set(['Cloud', 'Private cloud', 'Self-hosted', 'Air-gapped']);
const allowedUploadTypes = new Set(['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg']);
const allowedUploadExtensions = new Set(['.pdf', '.txt', '.md', '.png', '.jpg', '.jpeg']);
const MAX_UPLOAD_JSON_BYTES = 256 * 1024;

const validHttpUrl = (value) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
};

const validateApplication = (body) => {
  const missing = requiredFields.filter((key) => !String(body?.[key] || '').trim());
  if (missing.length) return { error: 'Complete every required field.', missing };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.work_email)) return { error: 'Enter a valid work email.' };
  if (!validHttpUrl(body.company_website)) return { error: 'Enter a valid company website.' };
  if (!allowedStages.has(body.current_stage) || !allowedTracks.has(body.preferred_track) || !allowedDeployments.has(body.deployment_requirement)) return { error: 'Choose one of the available application options.' };
  if (Object.entries(body).some(([key, value]) => !['architecture_file', 'website'].includes(key) && String(value).length > 5_000)) return { error: 'One or more fields are too long.' };
  if (body.architecture_file) {
    const upload = body.architecture_file;
    const extension = require('node:path').extname(String(upload.name || '')).toLowerCase();
    const uploadJson = JSON.stringify(upload);
    if (Buffer.byteLength(uploadJson, 'utf8') > MAX_UPLOAD_JSON_BYTES) return { error: 'The optional upload is too large.' };
    if (!allowedUploadExtensions.has(extension) || !allowedUploadTypes.has(String(upload.type || '').toLowerCase())) return { error: 'The optional upload type is not supported.' };
    if (!String(upload.data_url || '').startsWith(`data:${String(upload.type).toLowerCase()};base64,`)) return { error: 'The optional upload is invalid.' };
  }
  return { ok: true };
};

const highFitApplication = (body) => ['Pilot', 'Production'].includes(body.current_stage) && ['Implementation', 'Unsure'].includes(body.preferred_track);

const createPartnerApplicationService = ({ env = process.env, sendEmail, sql: injectedSql } = {}) => {
  let schemaReady;
  let transporter;
  const sql = injectedSql || (env.DATABASE_URL ? neon(env.DATABASE_URL) : null);
  const configured = () => Boolean(sql);
  const emailConfigured = () => Boolean(sendEmail || (env.SMTP_USER && env.SMTP_PASSWORD));
  const deliver = sendEmail || (async ({ from, to, replyTo, subject, html, text }) => {
    if (!transporter) transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(env.SMTP_PORT || 465),
      secure: String(env.SMTP_SECURE || 'true').toLowerCase() !== 'false',
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const result = await transporter.sendMail({ from, to, replyTo, subject, html, text });
    return result.messageId;
  });
  const ensureSchema = () => {
    if (!sql) throw new Error('DATABASE_URL is not configured.');
    if (!schemaReady) schemaReady = sql`
      CREATE TABLE IF NOT EXISTS partner_applications (
        id uuid PRIMARY KEY,
        submitted_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'received',
        high_fit boolean NOT NULL DEFAULT false,
        work_email text NOT NULL,
        company text NOT NULL,
        role text NOT NULL,
        company_website text NOT NULL,
        agent_workflow text NOT NULL,
        changing_facts text NOT NULL,
        audit_requirement text NOT NULL,
        current_stage text NOT NULL,
        preferred_track text NOT NULL,
        deployment_requirement text NOT NULL,
        architecture_file jsonb,
        attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
        internal_email_id text,
        confirmation_email_id text
      )`;
    return schemaReady;
  };

  const submit = async (body, id = crypto.randomUUID()) => {
    if (!configured()) throw new Error('Partner application service is not configured.');
    await ensureSchema();
    const highFit = highFitApplication(body);
    const attribution = { utm_source: body.utm_source || '', utm_medium: body.utm_medium || '', utm_campaign: body.utm_campaign || '', utm_term: body.utm_term || '', utm_content: body.utm_content || '', landing_page: body.landing_page || '', referring_url: body.referring_url || '' };
    await sql`INSERT INTO partner_applications (id, high_fit, work_email, company, role, company_website, agent_workflow, changing_facts, audit_requirement, current_stage, preferred_track, deployment_requirement, architecture_file, attribution) VALUES (${id}, ${highFit}, ${body.work_email}, ${body.company}, ${body.role}, ${body.company_website}, ${body.agent_workflow}, ${body.changing_facts}, ${body.audit_requirement}, ${body.current_stage}, ${body.preferred_track}, ${body.deployment_requirement}, ${JSON.stringify(body.architecture_file || null)}::jsonb, ${JSON.stringify(attribution)}::jsonb)`;

    const field = (label, value) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`;
    const internalHtml = `<h1>New founding cohort application</h1>${field('Company', body.company)}${field('Work email', body.work_email)}${field('Role', body.role)}${field('Website', body.company_website)}${field('Agent workflow', body.agent_workflow)}${field('Changing facts', body.changing_facts)}${field('Audit requirement', body.audit_requirement)}${field('Stage', body.current_stage)}${field('Track', body.preferred_track)}${field('Deployment', body.deployment_requirement)}${field('UTM source', attribution.utm_source)}${field('UTM campaign', attribution.utm_campaign)}${field('Landing page', attribution.landing_page)}${field('Referrer', attribution.referring_url)}`;
    const internalText = `New founding cohort application\n\nCompany: ${body.company}\nWork email: ${body.work_email}\nRole: ${body.role}\nWebsite: ${body.company_website}\nAgent workflow: ${body.agent_workflow}\nChanging facts: ${body.changing_facts}\nAudit requirement: ${body.audit_requirement}\nStage: ${body.current_stage}\nTrack: ${body.preferred_track}\nDeployment: ${body.deployment_requirement}\nUTM source: ${attribution.utm_source}\nUTM campaign: ${attribution.utm_campaign}\nLanding page: ${attribution.landing_page}\nReferrer: ${attribution.referring_url}`;
    const confirmationHtml = `<h1>Application received</h1><p>Thanks for applying to the Lians Founding Partner Cohort.</p><p>We will review your changing-facts workflow, reconstruction requirement, deployment fit, and preferred track. We will reply with a direct fit assessment and next step.</p><p><a href="https://www.lians.ai/#watch">Changing-facts demo</a> · <a href="https://www.lians.ai/research">Evaluation methodology</a> · <a href="https://www.lians.ai/design-partners">Cohort overview</a></p>`;
    const confirmationText = `Application received\n\nThanks for applying to the Lians Founding Partner Cohort. We will review your changing-facts workflow, reconstruction requirement, deployment fit, and preferred track. We will reply with a direct fit assessment and next step.\n\nDemo: https://www.lians.ai/#watch\nMethodology: https://www.lians.ai/research\nCohort: https://www.lians.ai/design-partners`;

    if (!emailConfigured()) {
      await sql`UPDATE partner_applications SET status = 'stored' WHERE id = ${id}`;
      return { id, highFit, notificationStatus: 'not_configured' };
    }

    try {
      const [internalEmailId, confirmationEmailId] = await Promise.all([
        deliver({ from: env.PARTNER_EMAIL_FROM || `Lians <${env.SMTP_USER}>`, to: env.PARTNER_NOTIFICATION_TO || 'sales@lians.ai', replyTo: body.work_email, subject: `New founding cohort application: ${String(body.company).replace(/[\r\n]+/g, ' ')}`, html: internalHtml, text: internalText }),
        deliver({ from: env.PARTNER_EMAIL_FROM || `Lians <${env.SMTP_USER}>`, to: body.work_email, replyTo: env.PARTNER_NOTIFICATION_TO || 'sales@lians.ai', subject: 'We received your Lians founding cohort application', html: confirmationHtml, text: confirmationText }),
      ]);
      await sql`UPDATE partner_applications SET status = 'notified', internal_email_id = ${internalEmailId}, confirmation_email_id = ${confirmationEmailId} WHERE id = ${id}`;
      return { id, highFit, internalEmailId, confirmationEmailId, notificationStatus: 'sent' };
    } catch {
      await sql`UPDATE partner_applications SET status = 'email_failed' WHERE id = ${id}`;
      return { id, highFit, notificationStatus: 'failed' };
    }
  };

  return { configured, emailConfigured, submit };
};

module.exports = { createPartnerApplicationService, highFitApplication, validateApplication };
