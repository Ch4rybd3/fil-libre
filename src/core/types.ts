// Modèle de données. Toutes les coordonnées sont en millimètres,
// origine au centre du cercle de broderie, axe Y vers le bas.

export interface Pt { x: number; y: number }
export type Poly = Pt[];

export enum Cmd { STITCH = 0, JUMP = 1, TRIM = 2, COLOR = 3, STOP = 4, END = 5 }

export interface Stitch { x: number; y: number; cmd: Cmd }

/** Liste de points générés pour un objet, d'une seule couleur. */
export interface StitchBlock { color: number; stitches: Stitch[] }

export type Underlay = 'none' | 'center' | 'edge' | 'zigzag' | 'tatami' | 'edge+tatami' | 'edge+zigzag';

export interface RunParams { length: number; repeats: 1 | 3 | 5 }
export interface SatinParams {
  density: number;        // espacement des points en mm (0.3–0.6)
  pullComp: number;       // compensation de traction (mm ajoutés de chaque côté)
  underlay: Underlay;
  maxLength: number;      // au-delà: point satin fractionné
}
export interface FillParams {
  pattern: 'tatami' | 'satin' | 'contour' | 'zigzag';
  angle: number;          // degrés
  spacing: number;        // espacement des rangs en mm
  length: number;         // longueur de point en mm
  offset: number;         // décalage de motif (0–1)
  pullComp: number;
  underlay: Underlay;
  edgeRun: boolean;       // contour en point avant après remplissage
}

interface Base {
  id: string;
  name: string;
  color: number;          // index dans design.threads
  visible: boolean;
  locked: boolean;
  tie: boolean;           // points d'arrêt début/fin
}

export interface RunObj extends Base { kind: 'run'; points: Pt[]; closed: boolean; run: RunParams }
export interface SatinObj extends Base { kind: 'satin'; points: Pt[]; width: number; closed: boolean; satin: SatinParams }
export interface FillObj extends Base { kind: 'fill'; contours: Poly[]; fill: FillParams; }
export interface AppliqueObj extends Base {
  kind: 'applique'; contours: Poly[];
  borderWidth: number; satin: SatinParams;
  placementStop: boolean;
}
export interface TextObj extends Base {
  kind: 'text';
  text: string;
  font: string;           // identifiant police
  size: number;           // hauteur des capitales en mm
  spacing: number;        // interlettrage mm
  lineHeight: number;     // multiplicateur
  align: 'left' | 'center' | 'right';
  arc: number;            // courbure en degrés (0 = droit, +/- arc)
  x: number; y: number;   // position du centre
  rotation: number;       // degrés
  scaleX: number; scaleY: number;
  style: 'satin' | 'fill' | 'run';
  fill: FillParams;
  run: RunParams;
  outline: boolean;       // contour en point avant
}
export interface StitchesObj extends Base { kind: 'stitches'; stitches: Stitch[] }

export type EmbObject = RunObj | SatinObj | FillObj | AppliqueObj | TextObj | StitchesObj;
export type Kind = EmbObject['kind'];

export interface Thread { r: number; g: number; b: number; name: string; code: string; chart: string }

export interface Hoop { id: string; name: string; w: number; h: number }

export interface BgImage { dataUrl: string; x: number; y: number; w: number; h: number; opacity: number; visible: boolean }

export interface Design {
  version: 1;
  name: string;
  hoop: string;
  threads: Thread[];
  objects: EmbObject[];
  fabric: string;         // couleur de tissu pour l'aperçu
  background?: BgImage;
}
