import type { PronunciationEntry } from '@studio/domain';
import { currentUser, demoHash, iso } from './actors.js';

type Seed = {
  canonicalForm: string;
  spokenForm: string | null;
  ipa: string | null;
  therapeuticArea: string;
  tags: string[];
  rationale: string;
  inGoldenSet: boolean;
};

/**
 * Pronunciation candidates seeded as REVIEW CANDIDATES only — no entry is an
 * authoritative "correct" pronunciation (Spec §13). Mirrors
 * sample-data/pronunciation-seed.json.
 */
const seeds: Seed[] = [
  {
    canonicalForm: 'Doravirine',
    spokenForm: 'Do-ra-vi-rin',
    ipa: 'ˌdoːʁaviˈʁiːn',
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['drug', 'INN', 'NNRTI'],
    rationale: 'INN-based candidate; German narration. Requires reviewer confirmation.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'Islatravir',
    spokenForm: 'Is-la-tra-vir',
    ipa: 'ɪsˈlatʁaviːɐ̯',
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['drug', 'INN', 'investigational'],
    rationale: 'Investigational agent; pronunciation candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'Bictegravir',
    spokenForm: 'Bik-te-gra-vir',
    ipa: 'bɪkˈteːɡʁaviːɐ̯',
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['drug', 'INN', 'INSTI'],
    rationale: 'Comparator agent; candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'Emtricitabin',
    spokenForm: 'Em-tri-ci-ta-bin',
    ipa: 'ɛmtʁit͡siˈtaːbiːn',
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['drug', 'INN', 'NRTI'],
    rationale: 'German spelling variant of emtricitabine. Candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'Tenofovir-Alafenamid',
    spokenForm: 'Te-no-fo-vir A-la-fe-na-mid',
    ipa: 'teˈnoːfoviːɐ̯ alafeˈnaːmɪt',
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['drug', 'INN', 'prodrug'],
    rationale: 'Compound drug name; hyphenated German form. Candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'HIV-1 RNA',
    spokenForm: 'H-I-V-eins R-N-A',
    ipa: null,
    therapeuticArea: 'Infectious disease / HIV',
    tags: ['acronym', 'lab', 'spell-out'],
    rationale: 'Say-as characters for HIV; ordinal treatment. Candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'CD4',
    spokenForm: 'C-D-vier',
    ipa: null,
    therapeuticArea: 'Immunology',
    tags: ['acronym', 'lab', 'spell-out'],
    rationale: 'Spell-out with cardinal "vier". Candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'DRESS',
    spokenForm: 'dress',
    ipa: 'dʁɛs',
    therapeuticArea: 'Dermatology / Adverse events',
    tags: ['acronym', 'adverse-event', 'read-as-word'],
    rationale: 'DRESS syndrome often read as a word. Confirm intended treatment.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'HBV',
    spokenForm: 'H-B-V',
    ipa: null,
    therapeuticArea: 'Hepatology / Infectious disease',
    tags: ['acronym', 'spell-out'],
    rationale: 'Hepatitis B virus; spell-out candidate for review.',
    inGoldenSet: true,
  },
  {
    canonicalForm: 'NCT04233879',
    spokenForm: 'N-C-T null vier zwei drei drei acht sieben neun',
    ipa: null,
    therapeuticArea: 'Clinical trials',
    tags: ['trial-id', 'spell-out'],
    rationale: 'Illustrative ClinicalTrials.gov identifier for demo; verify before use.',
    inGoldenSet: false,
  },
];

export const pronunciationEntries: PronunciationEntry[] = seeds.map((s, i) => ({
  id: `pron-${i + 1}`,
  version: 1,
  parentVersionId: null,
  createdBy: currentUser,
  createdAt: iso(9),
  modifiedBy: currentUser,
  modifiedAt: iso(9),
  contentHash: demoHash(s.canonicalForm + (s.ipa ?? '') + (s.spokenForm ?? '')),
  canonicalForm: s.canonicalForm,
  locale: 'de-DE',
  spokenForm: s.spokenForm,
  ipa: s.ipa,
  phonemeAlphabet: s.ipa ? 'ipa' : null,
  audioReferencePath: null,
  therapeuticArea: s.therapeuticArea,
  tags: s.tags,
  approvalStatus: i < 3 ? 'in-review' : 'draft',
  rationale: s.rationale,
  reviewHistory: [],
  inGoldenSet: s.inGoldenSet,
}));
