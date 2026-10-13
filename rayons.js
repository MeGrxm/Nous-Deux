// Rayons du magasin et devinette automatique du rayon d'un article.
// On lit les mots dans l'ordre : « jus d'orange » → Boissons, « pommes de terre » → Fruits & légumes.

export const AISLES = [
  ['fruits', '🥦', 'Fruits & légumes'],
  ['pain', '🥖', 'Boulangerie'],
  ['frais', '🧀', 'Frais & crèmerie'],
  ['viande', '🥩', 'Viande & poisson'],
  ['epicerie', '🥫', 'Épicerie salée'],
  ['sucre', '🍫', 'Petit-déj & sucré'],
  ['surgeles', '❄️', 'Surgelés'],
  ['boissons', '🥤', 'Boissons'],
  ['hygiene', '🧴', 'Hygiène & beauté'],
  ['maison', '🧽', 'Maison & entretien'],
  ['animaux', '🐾', 'Bébé & animaux'],
  ['autre', '📦', 'Autres'],
];

const WORDS = {
  fruits: 'fruit, légume, pomme, poire, banane, orange, citron, citron vert, clémentine, mandarine, pamplemousse, fraise, framboise, myrtille, cerise, raisin, pêche, nectarine, abricot, prune, kiwi, ananas, mangue, melon, pastèque, avocat, tomate, salade, laitue, roquette, mâche, épinard, carotte, courgette, aubergine, poivron, concombre, oignon, échalote, ail, pomme de terre, patate, patate douce, poireau, chou, brocoli, chou-fleur, haricot vert, champignon, radis, betterave, céleri, fenouil, persil, basilic, coriandre, menthe, ciboulette, thym, romarin, gingembre, potiron, courge, butternut, endive, artichaut, asperge, petit pois, maïs doux',
  pain: 'pain, baguette, croissant, brioche, viennoiserie, pain de mie, pain au chocolat, chocolatine, tradition, pain complet, wrap, tortilla',
  frais: 'lait, beurre, crème, crème fraîche, yaourt, fromage, fromage blanc, emmental, comté, gruyère, mozzarella, parmesan, feta, chèvre, camembert, brie, raclette, reblochon, œuf, jambon, lardon, bacon, saucisson, chorizo, knacki, saucisse, houmous, tofu, pâte brisée, pâte feuilletée, pâte à pizza, gnocchi, ravioli, tortellini, skyr, petit suisse, flan, mousse au chocolat, crème dessert',
  viande: 'viande, poulet, blanc de poulet, bœuf, steak, steak haché, viande hachée, porc, veau, agneau, dinde, canard, filet, escalope, rôti, côte, travers, merguez, poisson, saumon, cabillaud, colin, merlu, crevette, moule, gambas, noix de saint-jacques',
  epicerie: 'pâtes, spaghetti, penne, tagliatelle, coquillette, riz, semoule, couscous, quinoa, boulgour, lentille, pois chiche, haricot rouge, flageolet, farine, sel, poivre, huile, huile d\'olive, vinaigre, moutarde, mayonnaise, ketchup, sauce, sauce tomate, pesto, conserve, thon, sardine, olive, épice, curry, paprika, cumin, bouillon, cube, soupe, chips, cacahuète, noix, amande, pistache, biscuit apéritif, crackers, levure, purée, bocal, cornichon',
  sucre: 'sucre, café, capsule, dosette, thé, tisane, chocolat, chocolat noir, nutella, pâte à tartiner, confiture, miel, céréale, muesli, flocon d\'avoine, biscuit, gâteau, compote, madeleine, bonbon, cookie, sirop d\'érable',
  surgeles: 'surgelé, glace, sorbet, frite, pizza, poisson pané, légume surgelé, nugget',
  boissons: 'eau, eau gazeuse, jus, jus d\'orange, jus de pomme, soda, coca, limonade, bière, vin, vin rouge, vin blanc, rosé, champagne, cidre, sirop',
  hygiene: 'shampoing, shampooing, après-shampoing, gel douche, savon, dentifrice, brosse à dent, fil dentaire, déodorant, coton, coton-tige, rasoir, mousse à raser, mouchoir, crème hydratante, crème solaire, maquillage, démaquillant, serviette hygiénique, tampon, protège-slip',
  maison: 'papier toilette, essuie-tout, sopalin, lessive, adoucissant, liquide vaisselle, tablette lave-vaisselle, éponge, sac poubelle, javel, nettoyant, produit ménager, ampoule, pile, aluminium, papier aluminium, film alimentaire, papier cuisson, allumette, bougie',
  animaux: 'couche, lingette, petit pot, lait infantile, croquette, pâtée, litière, friandise',
};

function norm(s) {
  return String(s).toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const sing = w => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
const tokens = s => norm(s).split(' ').filter(Boolean).map(sing);

// Index : premier mot → expressions qui commencent par lui (les plus longues d'abord).
const INDEX = new Map();
for (const [aisle, list] of Object.entries(WORDS)) {
  for (const phrase of list.split(',')) {
    const tk = tokens(phrase);
    if (!tk.length) continue;
    if (!INDEX.has(tk[0])) INDEX.set(tk[0], []);
    INDEX.get(tk[0]).push([tk, aisle]);
  }
}
for (const arr of INDEX.values()) arr.sort((a, b) => b[0].length - a[0].length);

export function guessAisle(text) {
  const tk = tokens(text);
  for (let i = 0; i < tk.length; i++) {
    for (const [phrase, aisle] of INDEX.get(tk[i]) || []) {
      if (phrase.every((w, j) => tk[i + j] === w)) return aisle;
    }
  }
  return 'autre';
}
