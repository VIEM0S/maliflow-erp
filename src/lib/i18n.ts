import { useEffect, useState, useSyncExternalStore } from "react";

export type Locale = "fr" | "en";

const STORAGE_KEY = "alpha_locale";
const listeners = new Set<() => void>();
let current: Locale = "fr";

if (typeof window !== "undefined") {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "fr" || stored === "en") current = stored;
}

export function setLocale(l: Locale) {
  current = l;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, l);
  listeners.forEach((fn) => fn());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const dict = {
  fr: {
    "app.name": "Alpha ERP",
    "app.tagline": "ERP cloud pour commerces — Bamako & Afrique de l'Ouest",
    "nav.dashboard": "Tableau de bord",
    "nav.sales": "Ventes",
    "nav.products": "Produits",
    "nav.inventory": "Stock",
    "nav.customers": "Clients",
    "nav.suppliers": "Fournisseurs",
    "nav.credits": "Crédits",
    "nav.cash": "Caisse",
    "nav.quotes": "Devis",
    "nav.analytics": "Analytique",
    "nav.settings": "Paramètres",
    "auth.signIn": "Se connecter",
    "auth.signUp": "Créer un compte",
    "auth.email": "Email professionnel",
    "auth.password": "Mot de passe",
    "auth.fullName": "Nom complet",
    "auth.continueGoogle": "Continuer avec Google",
    "auth.or": "OU",
    "auth.noAccount": "Pas encore de compte ?",
    "auth.hasAccount": "Vous avez déjà un compte ?",
    "auth.signOut": "Se déconnecter",
    "auth.signInTitle": "Connectez-vous à votre espace",
    "auth.signUpTitle": "Lancez votre ERP en 2 minutes",
    "auth.signUpSub": "Essai 14 jours · Sans carte bancaire",
    "onboarding.title": "Configurez votre entreprise",
    "onboarding.sub": "Quelques infos pour personnaliser votre espace.",
    "onboarding.companyName": "Nom de l'entreprise",
    "onboarding.companyNamePh": "Quincaillerie Sogoniko",
    "onboarding.rccm": "N° RCCM",
    "onboarding.nif": "NIF",
    "onboarding.city": "Ville",
    "onboarding.address": "Adresse",
    "onboarding.phone": "Téléphone",
    "onboarding.country": "Pays",
    "onboarding.currency": "Devise",
    "onboarding.create": "Créer mon espace",
    "dashboard.welcome": "Bonjour",
    "dashboard.today": "Aujourd'hui",
    "dashboard.salesToday": "Ventes du jour",
    "dashboard.grossMargin": "Marge brute (7j)",
    "dashboard.stockValue": "Stock valorisé",
    "dashboard.overdueCredits": "Crédits en retard",
    "dashboard.revenue7d": "Revenus — 7 derniers jours",
    "dashboard.topProducts": "Top 5 produits",
    "dashboard.lowStock": "Alertes stock bas",
    "dashboard.cashRegister": "Caisse — aujourd'hui",
    "dashboard.theoretical": "Théorique",
    "dashboard.actual": "Réel",
    "dashboard.variance": "Écart",
    "dashboard.viewAll": "Tout voir",
    "dashboard.demoBadge": "Données de démonstration",
    "common.loading": "Chargement…",
    "common.error": "Une erreur est survenue",
    "common.retry": "Réessayer",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.next": "Suivant",
    "common.back": "Retour",
    "home.cta": "Commencer gratuitement",
    "home.login": "Connexion",
    "home.heroTitle": "L'ERP pensé pour les commerces d'Afrique de l'Ouest",
    "home.heroSub": "Gérez stocks, ventes, crédits et caisse en temps réel. Sans Excel. Sans cahier. Sans vol.",
    "home.feature1": "Stock toujours juste",
    "home.feature1Desc": "Mouvements atomiques, alertes de rupture, multi-magasin.",
    "home.feature2": "Caisse contrôlée",
    "home.feature2Desc": "Ouverture, fermeture, écarts justifiés. Fini les fuites.",
    "home.feature3": "Crédits suivis",
    "home.feature3Desc": "Échéances, relances, vieillissement. Vous récupérez votre argent.",
    "role.owner": "Propriétaire",
    "role.manager": "Gestionnaire",
    "role.cashier": "Caissier",
    "role.super_admin": "Super admin",
  },
  en: {
    "app.name": "Alpha ERP",
    "app.tagline": "Cloud ERP for retail — Bamako & West Africa",
    "nav.dashboard": "Dashboard",
    "nav.sales": "Sales",
    "nav.products": "Products",
    "nav.inventory": "Inventory",
    "nav.customers": "Customers",
    "nav.suppliers": "Suppliers",
    "nav.credits": "Credits",
    "nav.cash": "Cash Register",
    "nav.quotes": "Quotes",
    "nav.analytics": "Analytics",
    "nav.settings": "Settings",
    "auth.signIn": "Sign in",
    "auth.signUp": "Create account",
    "auth.email": "Work email",
    "auth.password": "Password",
    "auth.fullName": "Full name",
    "auth.continueGoogle": "Continue with Google",
    "auth.or": "OR",
    "auth.noAccount": "Don't have an account?",
    "auth.hasAccount": "Already have an account?",
    "auth.signOut": "Sign out",
    "auth.signInTitle": "Sign in to your workspace",
    "auth.signUpTitle": "Launch your ERP in 2 minutes",
    "auth.signUpSub": "14-day trial · No credit card",
    "onboarding.title": "Set up your company",
    "onboarding.sub": "A few details to personalize your workspace.",
    "onboarding.companyName": "Company name",
    "onboarding.companyNamePh": "Sogoniko Hardware",
    "onboarding.rccm": "RCCM number",
    "onboarding.nif": "Tax ID",
    "onboarding.city": "City",
    "onboarding.address": "Address",
    "onboarding.phone": "Phone",
    "onboarding.country": "Country",
    "onboarding.currency": "Currency",
    "onboarding.create": "Create workspace",
    "dashboard.welcome": "Hello",
    "dashboard.today": "Today",
    "dashboard.salesToday": "Sales today",
    "dashboard.grossMargin": "Gross margin (7d)",
    "dashboard.stockValue": "Stock value",
    "dashboard.overdueCredits": "Overdue credits",
    "dashboard.revenue7d": "Revenue — last 7 days",
    "dashboard.topProducts": "Top 5 products",
    "dashboard.lowStock": "Low stock alerts",
    "dashboard.cashRegister": "Cash register — today",
    "dashboard.theoretical": "Theoretical",
    "dashboard.actual": "Actual",
    "dashboard.variance": "Variance",
    "dashboard.viewAll": "View all",
    "dashboard.demoBadge": "Demo data",
    "common.loading": "Loading…",
    "common.error": "Something went wrong",
    "common.retry": "Retry",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.next": "Next",
    "common.back": "Back",
    "home.cta": "Start free",
    "home.login": "Login",
    "home.heroTitle": "The ERP built for West African retail",
    "home.heroSub": "Manage stock, sales, credits and cash in real time. No Excel. No notebook. No leaks.",
    "home.feature1": "Stock always accurate",
    "home.feature1Desc": "Atomic movements, low-stock alerts, multi-store.",
    "home.feature2": "Cash under control",
    "home.feature2Desc": "Open, close, justify variances. No more leaks.",
    "home.feature3": "Credits tracked",
    "home.feature3Desc": "Due dates, reminders, aging. Get your money back.",
    "role.owner": "Owner",
    "role.manager": "Manager",
    "role.cashier": "Cashier",
    "role.super_admin": "Super admin",
  },
} as const;

export type TKey = keyof (typeof dict)["fr"];

export function useLocale() {
  const l = useSyncExternalStore(
    subscribe,
    () => current,
    () => "fr" as Locale,
  );
  return l;
}

export function useT() {
  const l = useLocale();
  return (key: TKey) => dict[l][key] ?? key;
}

export function t(key: TKey, locale: Locale = current): string {
  return dict[locale][key] ?? key;
}

// Re-export hook to ensure react import resolves
export { useEffect, useState };