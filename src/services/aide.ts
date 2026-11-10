import type { Service } from '../core/types';

const CONTENT = [
  '3615 AIDE',
  '',
  "MODE D'EMPLOI",
  'La navigation utilise le paramètre q.',
  '',
  'MENU',
  "Ouvrez l'accueil sans paramètre q.",
  'Le menu affiche chaque service avec un numéro et un code.',
  '',
  'NUMEROS',
  'Donnez à q le numéro du service.',
  'Exemple : ?q=1.',
  '',
  'CODES',
  'Donnez à q le code complet.',
  'Code : 3615 AIDE',
  'Adresse : ?q=3615%20AIDE',
  'La casse et les espaces superflus sont ignorés.',
  '',
  'RETOUR',
  'Retirez q pour revoir le menu.',
].join('\n');

/** Explique la navigation par menu, numéro ou code de service. */
export const aideService: Service = {
  code: '3615 AIDE',
  title: 'Aide',
  description: "Mode d'emploi",
  async render() {
    return CONTENT;
  },
};
