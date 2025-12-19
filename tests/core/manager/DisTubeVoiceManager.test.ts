import { getVoiceConnection, VoiceConnectionStatus } from "@discordjs/voice";
import type { Mock, Mocked } from "vitest";
import { beforeEach, expect, test, vi } from "vitest";
import { DisTubeVoice as _DTV, DisTubeVoiceManager } from "@";

vi.mock("@/core/DisTubeVoice");
vi.mock(
  "@discordjs/voice",
  async importOriginal =>
    <object>{
      ...(await importOriginal()),
      getVoiceConnection: vi.fn(),
    },
);
vi.mock(
  "@/util",
  async importOriginal =>
    <object>{
      ...(await importOriginal()),
      isSupportedVoiceChannel: () => true,
    },
);

const DisTubeVoice: Mocked<typeof _DTV> = _DTV;

beforeEach(() => {
  vi.clearAllMocks();
});

function createFakeDisTube() {
  return {
    client: { user: { id: "123" } },
  };
}

const distube = createFakeDisTube();
const manager = new DisTubeVoiceManager(distube as any);
const channel1: any = {
  guildId: "123456789123456789",
};
const channel2: any = {
  guildId: "123456789012345678",
};

test("DisTubeVoiceManager#create()", () => {
  const voice = manager.create(channel1);
  manager.add(channel1.guildId, voice);
  expect(DisTubeVoice).toHaveBeenCalledTimes(1);
  expect(manager.get(channel1)).toBe(voice);
  const setter = vi.spyOn(voice, "channel", "set").mockImplementation(() => null);
  const existing = manager.create(channel1);
  expect(existing).toBe(voice);
  expect(DisTubeVoice).toHaveBeenCalledTimes(1);
  expect(manager.get(channel1)).toBe(voice);
  expect(setter).toHaveBeenCalledTimes(1);
});

test("DisTubeVoiceManager#join()", () => {
  manager.join(channel1);
  expect(manager.get(channel1)!.join).toHaveBeenCalledTimes(1);
  expect(manager.get(channel1)!.join).toHaveBeenCalledWith(channel1);
  manager.create = vi.fn();
  const fVoice = { join: vi.fn() };
  (<Mock>manager.create).mockReturnValueOnce(fVoice);
  manager.join(channel2);
  expect(manager.create).toHaveBeenCalledWith(channel2);
  expect(fVoice.join).toHaveBeenCalledTimes(1);
});

test("DisTubeVoiceManager#leave()", () => {
  manager.leave(channel1);
  expect(manager.get(channel1)!.leave).toHaveBeenCalledTimes(1);
  const fConnection = {
    destroy: vi.fn(),
    state: {
      status: VoiceConnectionStatus.Destroyed,
    },
  };
  (<Mock>getVoiceConnection).mockReturnValue(fConnection);
  manager.leave(channel2);
  expect(getVoiceConnection).toHaveBeenNthCalledWith(1, channel2.guildId, distube.client.user.id);
  expect(fConnection.destroy).not.toHaveBeenCalled();
  fConnection.state.status = VoiceConnectionStatus.Ready;
  manager.leave(channel2);
  expect(getVoiceConnection).toHaveBeenNthCalledWith(1, channel2.guildId, distube.client.user.id);
  expect(fConnection.destroy).toHaveBeenCalledTimes(1);
});
