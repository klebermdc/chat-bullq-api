import { buildResumeState, parseResumeState } from './resume-context';

describe('resume-context', () => {
  it('serializa cascadeDepth e visitedAutomations', () => {
    const state = buildResumeState({
      cascadeDepth: 2,
      visitedAutomations: ['a1', 'a2'],
    });
    expect(state).toEqual({ cascadeDepth: 2, visitedAutomations: ['a1', 'a2'] });
  });

  it('reconstrói com defaults seguros quando o JSON está corrompido/nulo', () => {
    expect(parseResumeState(null)).toEqual({
      cascadeDepth: 0,
      visitedAutomations: [],
    });
    expect(parseResumeState({ foo: 'bar' })).toEqual({
      cascadeDepth: 0,
      visitedAutomations: [],
    });
  });

  it('reconstrói valores válidos', () => {
    expect(
      parseResumeState({ cascadeDepth: 3, visitedAutomations: ['x'] }),
    ).toEqual({ cascadeDepth: 3, visitedAutomations: ['x'] });
  });
});
