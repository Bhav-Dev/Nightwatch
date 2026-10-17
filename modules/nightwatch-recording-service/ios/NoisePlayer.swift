import AVFoundation
import ExpoModulesCore

/**
 Sleep sounds: white, pink or brown noise generated live (so there is no loop and no seam),
 played through an AVAudioEngine of its own. Fades in, then fades out over the last part of the
 timer and stops by itself. Starting and stopping run on one serial queue; the samples are made
 on the engine's render thread.

 The audio session is shared with expo-audio, whose microphone stream may be running. What this
 relies on, and leaves alone:
 - While recording, the session is already play-and-record (PlaybackWhileRecording sees to that
   when the stream starts), so the noise just plays through it. Its category, mode, sample rate
   and active state are not touched then: changing any of them changes the hardware under the
   microphone's engine, which stops it.
 - With nothing recording (the preview on Tonight) the session is in one of expo-audio's
   ambient categories, which the ringer switch mutes. It is switched to playback, mixing with
   other apps as the media stream does on Android, and put back when the noise stops.
 - The session is never deactivated here: with the microphone running, that would stop it too.
 */
final class NoisePlayer {
  /** The colours are tuned at this rate, as on Android; the engine's mixer converts it for the hardware. */
  private static let rate = 22_050.0
  private static let fadeInS = 3.0
  /** Long enough for a render buffer or two, the first of which ramps to silence. */
  private static let rampS = 0.15

  private let queue = DispatchQueue(label: "app.nightwatch.recordingservice.noise")

  private let lock = NSLock()
  // Guarded by lock: isPlaying is read on the JS thread.
  private var playing = false
  /** Bumped by every start and stop, so work queued for an older one does nothing. */
  private var generation = 0

  // Only touched on queue.
  private var engine: AVAudioEngine?
  private var engineObserver: NSObjectProtocol?
  private var envelope: NoiseEnvelope?
  private var color = "white"
  private var sessionObservers: [NSObjectProtocol] = []
  private var sessionToRestore: SessionSettings?

  var isPlaying: Bool {
    lock.lock()
    defer { lock.unlock() }
    return playing
  }

  func start(color: String, gain: Float, durationS: Double, fadeOutS: Double) {
    let gen = nextGeneration(playing: true)
    queue.async {
      self.shutDown(ramp: true)
      guard self.isCurrent(gen) else {
        return
      }
      self.color = color
      self.envelope = NoiseEnvelope(
        gain: min(max(gain, 0), 1),
        durationS: max(0, durationS),
        fadeInS: Self.fadeInS,
        fadeOutS: max(0.001, fadeOutS)
      )
      self.observeSession(gen)
      self.play(gen)
      // The fade-out ends as the timer does; then the engine stops by itself.
      self.queue.asyncAfter(deadline: .now() + max(0, durationS)) {
        guard self.isCurrent(gen) else {
          return
        }
        self.shutDown(ramp: false)
        self.finished(gen)
      }
    }
  }

  /** Ramps down over a buffer and stops; `completion` runs once it has. */
  func stop(completion: @escaping () -> Void) {
    _ = nextGeneration(playing: false)
    queue.async {
      self.shutDown(ramp: true)
      completion()
    }
  }

  /** Builds and starts an engine for the current noise. If that fails, the noise is over. */
  private func play(_ gen: Int) {
    guard let envelope else {
      return
    }
    do {
      try preparePlayback()
      let engine = AVAudioEngine()
      // Checked first: connecting to an output with no channels raises an exception Swift cannot catch.
      let hardware = engine.outputNode.outputFormat(forBus: 0)
      guard hardware.channelCount > 0, hardware.sampleRate > 0 else {
        throw NoiseError(description: "no audio output is available")
      }
      guard let format = AVAudioFormat(standardFormatWithSampleRate: Self.rate, channels: 1) else {
        throw NoiseError(description: "could not make the noise format")
      }
      let source = NoiseSource(color: color)
      let node = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList in
        source.render(audioBufferList, frames: Int(frameCount), level: envelope.level())
        return noErr
      }
      engine.attach(node)
      engine.connect(node, to: engine.mainMixerNode, format: format)
      engine.prepare()
      try engine.start()
      self.engine = engine
      // The engine stops itself when the output hardware changes (headphones, a call): start a new one.
      engineObserver = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange,
        object: engine,
        queue: nil
      ) { [weak self] _ in
        self?.queue.async { self?.restart(gen) }
      }
    } catch {
      log.warn("Sleep sounds could not play: \(error)")
      shutDown(ramp: false)
      finished(gen)
    }
  }

  /** Replaces a stopped engine, if the noise is still meant to be playing. */
  private func restart(_ gen: Int) {
    guard isCurrent(gen), engine != nil, let envelope, envelope.remainingS > 0 else {
      return
    }
    stopEngine()
    play(gen)
  }

  private func observeSession(_ gen: Int) {
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    sessionObservers = [
      // An interruption (a call, Siri) stops the engine; carry on once it ends.
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .ended else {
          return
        }
        self?.queue.async { self?.restart(gen) }
      },
      // Every audio object is invalid after a media services reset.
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil) { [weak self] _ in
        self?.queue.async { self?.restart(gen) }
      },
    ]
  }

  /** Makes sure the session can play, without disturbing a recording (see the class comment). */
  private func preparePlayback() throws {
    let session = AVAudioSession.sharedInstance()
    switch session.category {
    case .playAndRecord, .playback:
      // Recording, or already set up to play: use it as it is.
      break
    case .record:
      // A recording that cannot play anything, and switching now would stop its microphone.
      throw NoiseError(description: "the audio session is recording only")
    default:
      if sessionToRestore == nil {
        sessionToRestore = SessionSettings(category: session.category, mode: session.mode, options: session.categoryOptions)
      }
      try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    }
    // Already active while recording, when this does nothing.
    try session.setActive(true)
  }

  /** Puts back the category changed for a preview, unless something else has set its own since. */
  private func restoreSession() {
    guard let previous = sessionToRestore else {
      return
    }
    sessionToRestore = nil
    let session = AVAudioSession.sharedInstance()
    guard session.category == .playback, session.mode == .default, session.categoryOptions == [.mixWithOthers] else {
      return
    }
    do {
      try session.setCategory(previous.category, mode: previous.mode, options: previous.options)
    } catch {
      log.warn("Could not put the audio session back after sleep sounds: \(error)")
    }
  }

  private func stopEngine() {
    if let engineObserver {
      NotificationCenter.default.removeObserver(engineObserver)
    }
    engineObserver = nil
    engine?.stop()
    engine = nil
  }

  /** Stops everything, after ramping to silence when asked, and puts the session back. */
  private func shutDown(ramp: Bool) {
    if ramp, let engine, engine.isRunning, let envelope {
      envelope.stopping = true
      Thread.sleep(forTimeInterval: Self.rampS)
    }
    stopEngine()
    envelope = nil
    for observer in sessionObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    sessionObservers = []
    restoreSession()
  }

  private func nextGeneration(playing: Bool) -> Int {
    lock.lock()
    defer { lock.unlock() }
    generation += 1
    self.playing = playing
    return generation
  }

  private func isCurrent(_ gen: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return generation == gen
  }

  /** The noise has ended by itself (timer or failure); a newer start keeps playing. */
  private func finished(_ gen: Int) {
    lock.lock()
    defer { lock.unlock() }
    if generation == gen {
      playing = false
    }
  }
}

private struct SessionSettings {
  let category: AVAudioSession.Category
  let mode: AVAudioSession.Mode
  let options: AVAudioSession.CategoryOptions
}

private struct NoiseError: Error, CustomStringConvertible {
  let description: String
}

/**
 The noise level over time. Made before the engine starts and read on the render thread; only
 `stopping` changes afterwards, once, from the player's queue. A Bool store cannot tear, and a
 render thread that sees it a buffer late just ramps down a buffer later.
 */
final class NoiseEnvelope {
  private let gain: Float
  private let durationS: Double
  private let fadeInS: Double
  private let fadeOutS: Double
  private let startedAt = mach_absolute_time()
  private let secondsPerTick: Double
  var stopping = false

  init(gain: Float, durationS: Double, fadeInS: Double, fadeOutS: Double) {
    self.gain = gain
    self.durationS = durationS
    self.fadeInS = fadeInS
    self.fadeOutS = fadeOutS
    var timebase = mach_timebase_info_data_t()
    mach_timebase_info(&timebase)
    secondsPerTick = Double(timebase.numer) / Double(timebase.denom) / 1_000_000_000
  }

  /** Host time, which keeps counting through an interruption, as Android's elapsedRealtime does. */
  private var elapsedS: Double {
    let now = mach_absolute_time()
    return now > startedAt ? Double(now - startedAt) * secondsPerTick : 0
  }

  var remainingS: Double {
    durationS - elapsedS
  }

  /** The level to reach by the end of the next buffer: fade-in, gain, and the fade-out over the end of the timer. */
  func level() -> Float {
    if stopping {
      return 0
    }
    let elapsed = elapsedS
    let remaining = durationS - elapsed
    let fadeIn = min(1, elapsed / fadeInS)
    let fadeOut = remaining < fadeOutS ? max(0, remaining / fadeOutS) : 1
    return gain * Float(fadeIn * fadeOut)
  }
}

/**
 White, pink (Paul Kellet's filter) or brown (leaky integrator) noise in about [-1, 1], the same
 filters as on Android. Render thread only: no locks, no allocation.
 */
final class NoiseSource {
  private enum Color {
    case white, pink, brown
  }

  private let color: Color
  /** xorshift32 state: cheap, and safe on the render thread (the system generator may lock). */
  private var seed: UInt32
  private var b0: Float = 0
  private var b1: Float = 0
  private var b2: Float = 0
  private var b3: Float = 0
  private var b4: Float = 0
  private var b5: Float = 0
  private var b6: Float = 0
  private var brown: Float = 0
  /** The level the last buffer ended at, so each buffer ramps on from it (no clicks). */
  private var lastLevel: Float = 0

  init(color: String) {
    switch color {
    case "pink": self.color = .pink
    case "brown": self.color = .brown
    default: self.color = .white
    }
    seed = UInt32.random(in: 1...UInt32.max)
  }

  /** Fills the buffers with noise, the gain moving smoothly from the last buffer's level to `level`. */
  func render(_ list: UnsafeMutablePointer<AudioBufferList>, frames requested: Int, level: Float) {
    let buffers = UnsafeMutableAudioBufferListPointer(list)
    guard buffers.count > 0, let out = buffers[0].mData?.assumingMemoryBound(to: Float.self) else {
      return
    }
    let frames = min(requested, Int(buffers[0].mDataByteSize) / MemoryLayout<Float>.size)
    if frames <= 0 {
      return
    }
    // Filter state in locals for the loop, written back after.
    var seed = self.seed
    var b0 = self.b0, b1 = self.b1, b2 = self.b2, b3 = self.b3, b4 = self.b4, b5 = self.b5, b6 = self.b6
    var brown = self.brown
    let from = lastLevel
    let step = (level - from) / Float(frames)
    for i in 0..<frames {
      seed ^= seed << 13
      seed ^= seed >> 17
      seed ^= seed << 5
      let white = Float(seed >> 8) * (2 / 16_777_216) - 1
      let sample: Float
      switch color {
      case .pink:
        b0 = 0.99886 * b0 + white * 0.0555179
        b1 = 0.99332 * b1 + white * 0.0750759
        b2 = 0.96900 * b2 + white * 0.1538520
        b3 = 0.86650 * b3 + white * 0.3104856
        b4 = 0.55000 * b4 + white * 0.5329522
        b5 = -0.7616 * b5 - white * 0.0168980
        let low: Float = b0 + b1 + b2 + b3
        let pink: Float = low + b4 + b5 + b6 + white * 0.5362
        b6 = white * 0.115926
        sample = pink * 0.11
      case .brown:
        brown = (brown + 0.02 * white) / 1.02
        sample = brown * 3.5
      case .white:
        sample = white * 0.5
      }
      let gain = from + step * Float(i)
      out[i] = min(1, max(-1, sample * gain))
    }
    self.seed = seed
    self.b0 = b0
    self.b1 = b1
    self.b2 = b2
    self.b3 = b3
    self.b4 = b4
    self.b5 = b5
    self.b6 = b6
    self.brown = brown
    lastLevel = level
    // The format is mono, so there is one buffer; any others get the same samples.
    for index in 1..<buffers.count {
      if let other = buffers[index].mData {
        memcpy(other, out, min(Int(buffers[index].mDataByteSize), frames * MemoryLayout<Float>.size))
      }
    }
  }
}
