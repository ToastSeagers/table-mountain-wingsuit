import { stubScenario } from '../../src/flight/scripting';

/** Spec section 7 "trim test": zero input from exit for 20 s. */
export const trim = stubScenario('trim', 20, () => {}, 'Hands off from exit for 20 s');
