interface MediaSample {
  sessionId: string;
  socketId: string;
  role: string;
  rtt: number;
  jitter: number;
  packetLossFraction: number;
  timestamp: number;
}

const mediaSamples = new Map<string, MediaSample>();

export function recordMediaSample(sample: MediaSample): void {
  mediaSamples.set(`${sample.sessionId}:${sample.socketId}`, sample);
}

export function renderPrometheusMetrics(activeSessions: number, activeParticipants: number): string {
  const samples = Array.from(mediaSamples.values());
  const avg = (selector: (sample: MediaSample) => number): number => {
    if (samples.length === 0) return 0;
    return samples.reduce((sum, sample) => sum + selector(sample), 0) / samples.length;
  };

  return [
    '# HELP atomquest_active_sessions Active sessions tracked in Redis.',
    '# TYPE atomquest_active_sessions gauge',
    `atomquest_active_sessions ${activeSessions}`,
    '# HELP atomquest_active_participants Active participants tracked in Redis.',
    '# TYPE atomquest_active_participants gauge',
    `atomquest_active_participants ${activeParticipants}`,
    '# HELP atomquest_media_rtt_seconds Average client reported RTT.',
    '# TYPE atomquest_media_rtt_seconds gauge',
    `atomquest_media_rtt_seconds ${avg((sample) => sample.rtt)}`,
    '# HELP atomquest_media_jitter_seconds Average client reported jitter.',
    '# TYPE atomquest_media_jitter_seconds gauge',
    `atomquest_media_jitter_seconds ${avg((sample) => sample.jitter)}`,
    '# HELP atomquest_media_packet_loss_fraction Average client reported packet loss fraction.',
    '# TYPE atomquest_media_packet_loss_fraction gauge',
    `atomquest_media_packet_loss_fraction ${avg((sample) => sample.packetLossFraction)}`,
    '',
  ].join('\n');
}
