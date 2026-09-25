// Test stand-in for react-native-incall-manager: records every call.
export const calls: string[] = [];
export default {
  start: (options: { media: string }) => calls.push(`start:${options.media}`),
  setForceSpeakerphoneOn: (on: boolean) => calls.push(`speaker:${on}`),
  stop: () => calls.push("stop"),
};
