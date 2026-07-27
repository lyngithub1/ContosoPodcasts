import type { ScriptTemplate } from '@studio/domain';

/** Three seed templates mirroring the reference material (Spec §4.4). */
export const scriptTemplates: ScriptTemplate[] = [
  {
    id: 'tmpl-plain',
    name: 'Plain narration',
    form: 'plain-narration',
    description: 'Continuous explanatory single-narrator script.',
    requiresSpeakers: false,
    sections: [{ heading: 'Narration', directionCue: 'calm, explanatory' }],
    mandatoryBoilerplate: [
      'This recording was generated using synthetic speech.',
      'This content is informational and is not medical advice.',
    ],
  },
  {
    id: 'tmpl-structured',
    name: 'Structured narration with delivery cues',
    form: 'structured-narration',
    description: 'Sections with friendly delivery directions (calm, deliberate, dynamic, pauses).',
    requiresSpeakers: false,
    sections: [
      { heading: 'Intro', directionCue: 'calm, explanatory' },
      { heading: 'Study design', directionCue: 'deliberate' },
      { heading: 'Efficacy', directionCue: 'dynamic' },
      { heading: 'Safety', directionCue: 'cautious, deliberate' },
      { heading: 'Interpretation', directionCue: 'calm' },
      { heading: 'Outro', directionCue: 'warm, closing' },
    ],
    mandatoryBoilerplate: [
      'This recording was generated using synthetic speech.',
      'This content is informational and is not medical advice.',
    ],
  },
  {
    id: 'tmpl-host-expert',
    name: 'Host / Expert discussion',
    form: 'host-expert',
    description: 'Two clearly assigned speakers with conversational transitions.',
    requiresSpeakers: true,
    sections: [
      { heading: 'Opening', directionCue: 'conversational' },
      { heading: 'Discussion', directionCue: 'explanatory' },
      { heading: 'Safety', directionCue: 'cautious' },
      { heading: 'Takeaways', directionCue: 'authoritative' },
    ],
    mandatoryBoilerplate: [
      'This recording was generated using synthetic speech.',
      'This content is informational and is not medical advice.',
    ],
  },
];
