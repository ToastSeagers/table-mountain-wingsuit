import type { Scenario } from '../../src/flight/scripting';
import { STUB_EXIT, STUB_EXIT_HEADING_DEG } from '../../src/flight/stub-terrain';

// The Gate 3 flight: exit 1 stand-in on the stub cliff, a slight early dive to shorten the start
// arc, a long near-max-glide cruise, deploy at 200 m AGL, full-flight canopy, flare at 3.5 m.
// Target: touchdown with x between 2,900 and 3,100 (spec section 6 beach).

export const EARLY_DIVE_S = 2.5;
export const EARLY_DIVE_PITCH = -0.4;
export const CRUISE_PITCH = 0.15;
export const DEPLOY_AGL_M = 200;
export const FLARE_AGL_M = 3.5;

export const campsBay: Scenario = {
  name: 'camps-bay',
  description:
    'Exit 1 stand-in to the beach: slight early dive, max-glide cruise, deploy at 200 m AGL',
  exit: STUB_EXIT,
  headingDeg: STUB_EXIT_HEADING_DEG,
  durationS: 180,
  script: (t, st, input) => {
    if (st.phase === 'freefall' || st.phase === 'wingsuit') {
      input.pitch = t < EARLY_DIVE_S ? EARLY_DIVE_PITCH : CRUISE_PITCH;
      input.deploy = st.aglM <= DEPLOY_AGL_M;
    } else if (st.phase === 'canopy') {
      input.flare = st.aglM <= FLARE_AGL_M;
    }
  },
};
