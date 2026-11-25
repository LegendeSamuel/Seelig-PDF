import brandConfig from '../brand/brand.config.json';

export const BRAND = Object.freeze({
  ...brandConfig,
  contact: Object.freeze({ ...(brandConfig.contact || {}) }),
  assets: Object.freeze({ ...(brandConfig.assets || {}) })
});

export function applyBrandChrome() {
  const wordmark = document.getElementById('brand-wordmark-img');
  if (wordmark) {
    wordmark.src = BRAND.assets.wordmarkLight;
    wordmark.alt = BRAND.brandName;
  }

  const badge = document.getElementById('brand-badge-text');
  if (badge) badge.textContent = BRAND.shortBadge;

  const brandLink = document.getElementById('brand-home-link');
  if (brandLink) brandLink.setAttribute('aria-label', `${BRAND.appName} Startseite`);

  const websiteNav = document.getElementById('nav-website-link');
  if (websiteNav) {
    websiteNav.href = BRAND.websiteUrl;
    websiteNav.textContent = BRAND.brandName;
  }

  const footerMark = document.getElementById('footer-mark-img');
  if (footerMark) {
    footerMark.src = BRAND.assets.markDarkOnAccent;
    footerMark.alt = BRAND.brandName;
  }

  const footerWebsite = document.getElementById('footer-website-link');
  if (footerWebsite) {
    footerWebsite.href = BRAND.websiteUrl;
    footerWebsite.setAttribute('aria-label', `${BRAND.brandName} Website`);
  }

  const imprint = document.getElementById('footer-imprint-link');
  if (imprint) imprint.href = BRAND.imprintUrl;

  const privacy = document.getElementById('footer-privacy-link');
  if (privacy) privacy.href = BRAND.privacyUrl;

  const emailLink = document.getElementById('footer-email-link');
  if (emailLink) emailLink.href = `mailto:${BRAND.contact.email}`;

  const igLink = document.getElementById('footer-instagram-link');
  if (igLink) igLink.href = BRAND.contact.instagramUrl;

  const portLink = document.getElementById('footer-portfolio-link');
  if (portLink) portLink.href = BRAND.contact.portfolioUrl;

  const copyLine = document.getElementById('footer-copyright-line');
  if (copyLine) {
    copyLine.textContent = `© 2026 ${BRAND.author} · ${BRAND.appName} · Verarbeitung ausschließlich lokal`;
  }
}
