export const ROLE_OPTIONS = [
  { id: 'photographer', label: 'Fotograaf', desc: 'Deel shoots, lichtopstellingen en vind modellen.' },
  { id: 'model', label: 'Model', desc: 'Bouw je portfolio en vind veilige samenwerkingen.' },
  { id: 'artist', label: 'Artist', desc: 'Deel kunstzinnige projecten.' },
  { id: 'stylist', label: 'Stylist', desc: 'Laat je styling werk zien.' },
  { id: 'mua', label: 'MUA', desc: 'Visagie en special effects.' },
  { id: 'hair', label: 'Hairstylist', desc: 'Haarstyling en verzorging.' },
  { id: 'art_director', label: 'Art Director', desc: 'Conceptontwikkeling en visuele regie.' },
  { id: 'retoucher', label: 'Retoucher', desc: 'Nabewerking en high-end retouching.' },
  { id: 'videographer', label: 'Videograaf', desc: 'Video producties en reels.' },
  { id: 'producer', label: 'Producer', desc: 'Productie en planning van shoots.' },
  { id: 'assistent', label: 'Assistent', desc: 'Ondersteuning op de set.' },
  { id: 'agency', label: 'Agency', desc: 'Vertegenwoordig talent.' },
  { id: 'company', label: 'Company', desc: 'Merk, studio of bedrijf.' },
  { id: 'fan', label: 'Fan', desc: 'Word fan van je favoriete makers en bewaar inspiratie.' },
];

export const getRoleLabel = (roleId) => ROLE_OPTIONS.find((role) => role.id === roleId)?.label || roleId || 'Maker';
