import AVFoundation
import AudioToolbox

/**
 Encodes 16-bit little-endian mono PCM to AAC-LC in an .m4a file: one sound segment of the
 night. Uses the system encoder through AVAudioFile, so no codec ships with the app.
 Not thread safe: the module only touches it from its encoder queue.
 */
final class AacSegmentWriter {
  private let url: URL
  private var file: AVAudioFile?
  /** What write() hands the file: 16-bit interleaved mono at the segment's sample rate. */
  private let format: AVAudioFormat
  private var framesWritten: AVAudioFramePosition = 0

  init(url: URL, sampleRate: Int, bitrate: Int) throws {
    self.url = url
    let files = FileManager.default
    try files.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? files.removeItem(at: url)

    var settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVAudioFileTypeKey: kAudioFileM4AType,
      AVSampleRateKey: Double(sampleRate),
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: bitrate,
    ]
    let file: AVAudioFile
    do {
      file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatInt16, interleaved: true)
    } catch {
      // The encoder takes only some bit rates at each sample rate; its own choice still makes a
      // usable file, so a rejected rate should not cost the segment.
      try? files.removeItem(at: url)
      settings.removeValue(forKey: AVEncoderBitRateKey)
      file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatInt16, interleaved: true)
    }
    let format = file.processingFormat
    guard format.commonFormat == .pcmFormatInt16, format.channelCount == 1 else {
      try? files.removeItem(at: url)
      throw SegmentError(description: "unexpected processing format \(format)")
    }
    self.file = file
    self.format = format
  }

  deinit {
    // Normally closed by finish() or abort(); this only stops a forgotten file staying open.
    close()
  }

  func write(_ pcm: Data) throws {
    guard let file else {
      throw SegmentError(description: "the segment is closed")
    }
    let frames = pcm.count / 2 // whole 16-bit samples only
    if frames == 0 {
      return
    }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
          let channel = buffer.int16ChannelData else {
      throw SegmentError(description: "could not make a PCM buffer")
    }
    // Apple's processors are little-endian, so the bytes are already Int16s in native order.
    pcm.withUnsafeBytes { bytes in
      if let source = bytes.baseAddress {
        memcpy(channel[0], source, frames * 2)
      }
    }
    buffer.frameLength = AVAudioFrameCount(frames)
    try file.write(from: buffer)
    framesWritten += AVAudioFramePosition(frames)
  }

  /** Finishes the file. Returns its size in bytes, or 0 (file deleted) if nothing was encoded. */
  func finish() -> Int {
    close()
    let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
    let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
    if framesWritten == 0 || size == 0 {
      try? FileManager.default.removeItem(at: url)
      return 0
    }
    return size
  }

  /** Gives up on this segment and deletes its file. */
  func abort() {
    close()
    try? FileManager.default.removeItem(at: url)
  }

  /**
   AVAudioFile writes the rest of the AAC and the MP4 index when it closes: explicitly from iOS 18,
   and before that when the last reference goes. The pool makes sure no autoreleased reference
   keeps it open while the size is read.
   */
  private func close() {
    autoreleasepool {
      if #available(iOS 18.0, *) {
        file?.close()
      }
      file = nil
    }
  }
}

private struct SegmentError: Error, CustomStringConvertible {
  let description: String
}
