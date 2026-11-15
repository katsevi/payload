export interface CreditEntry {
  id: 'astronaut' | 'walker' | 'galaxy' | 'erizon' | 'console' | 'fontChakra' | 'fontBarlow' | 'fontJetbrains';
  title: string;
  author: string;
  authorUrl: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  commercialOk: boolean;
  /** Clave i18n (ns ui) con la indicación de modificación. */
  modifiedKey: string;
  /** Clave i18n de la fuente (por defecto `credits.source`, Sketchfab). */
  sourceKey?: string;
}

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const CC_BY_NC_ND = 'https://creativecommons.org/licenses/by-nc-nd/4.0/';
const OFL = 'https://openfontlicense.org/open-font-license-official-text/';

/** Atribuciones de los modelos 3D (Sketchfab) y de las tipografías (OFL). Espejo de assets/CREDITS.md. */
export const CREDITS: CreditEntry[] = [
  {
    id: 'astronaut', title: 'Astronaut by Jungle Jim', author: 'Jungle Jim', authorUrl: 'https://sketchfab.com/jungle_jim',
    sourceUrl: 'https://sketchfab.com/3d-models/astronaut-by-jungle-jim-c775a977606a4e4e990afe783c6bc845',
    license: 'CC-BY 4.0', licenseUrl: CC_BY, commercialOk: true, modifiedKey: 'credits.modifiedCompressed',
  },
  {
    id: 'walker', title: 'Aurora G9 Expedition Walker Mech', author: 'Jungle Jim', authorUrl: 'https://sketchfab.com/jungle_jim',
    sourceUrl: 'https://sketchfab.com/3d-models/aurora-g9-expedition-walker-mech-943b364f0a01414c9828d345a19fb900',
    license: 'CC-BY 4.0', licenseUrl: CC_BY, commercialOk: true, modifiedKey: 'credits.modifiedCompressed',
  },
  {
    id: 'galaxy', title: 'Our Milky Way galaxy', author: 'aditya299792', authorUrl: 'https://sketchfab.com/aditya299792',
    sourceUrl: 'https://sketchfab.com/3d-models/our-milky-way-galaxy-f4d5ff16b66c4ed38bc07402030cbc30',
    license: 'CC-BY 4.0', licenseUrl: CC_BY, commercialOk: true, modifiedKey: 'credits.modifiedMeshopt',
  },
  {
    id: 'erizon', title: 'Programme ERIZON', author: 'nejenabinupa', authorUrl: 'https://sketchfab.com/nejenabinupa',
    sourceUrl: 'https://sketchfab.com/3d-models/programme-erizon-1dfbae39ee674334848da02301b77d68',
    license: 'CC-BY-NC-ND 4.0', licenseUrl: CC_BY_NC_ND, commercialOk: false, modifiedKey: 'credits.modifiedTechnical',
  },
  {
    id: 'console', title: 'Sci-Fi Computer Desk Console', author: 'Inditrion Dradnon', authorUrl: 'https://sketchfab.com/dradnon',
    sourceUrl: 'https://sketchfab.com/3d-models/sci-fi-computer-desk-console-28c67457f2ef4973a0bbc8b667bb183f',
    license: 'CC-BY 4.0', licenseUrl: CC_BY, commercialOk: true, modifiedKey: 'credits.modifiedCompressed',
  },
  // Tipografías de la interfaz (sistema visual): OFL 1.1, empaquetadas con @fontsource (sin peticiones a terceros).
  {
    id: 'fontChakra', title: 'Chakra Petch', author: 'Cadson Demak', authorUrl: 'https://github.com/cadsondemak/Chakra-Petch',
    sourceUrl: 'https://fonts.google.com/specimen/Chakra+Petch', license: 'OFL 1.1', licenseUrl: OFL, commercialOk: true,
    modifiedKey: 'credits.modifiedNone', sourceKey: 'credits.sourceFonts',
  },
  {
    id: 'fontBarlow', title: 'Barlow', author: 'Jeremy Tribby', authorUrl: 'https://github.com/jpt/barlow',
    sourceUrl: 'https://fonts.google.com/specimen/Barlow', license: 'OFL 1.1', licenseUrl: OFL, commercialOk: true,
    modifiedKey: 'credits.modifiedNone', sourceKey: 'credits.sourceFonts',
  },
  {
    id: 'fontJetbrains', title: 'JetBrains Mono', author: 'JetBrains', authorUrl: 'https://www.jetbrains.com/lp/mono/',
    sourceUrl: 'https://fonts.google.com/specimen/JetBrains+Mono', license: 'OFL 1.1', licenseUrl: OFL, commercialOk: true,
    modifiedKey: 'credits.modifiedNone', sourceKey: 'credits.sourceFonts',
  },
];
