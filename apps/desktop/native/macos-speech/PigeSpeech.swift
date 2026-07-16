import AVFAudio
import AVFoundation
import CoreMedia
import Foundation
import Speech

private let protocolVersion = 1
private let maxTranscriptUTF16Units = 32_000
private let maxTranscriptUTF8Bytes = 96_000
private let maxProtocolLineBytes = 128 * 1024

private struct HelperEvent: Encodable {
    let protocolVersion: Int
    let kind: String
    let sessionId: String?
    let status: String?
    let reason: String?
    let permission: String?
    let transcript: String?
    let metering: String?
    let elapsedMs: Int?
    let level: Double?
}

private struct SessionCommand: Decodable {
    let operation: String
    let sessionId: String
}

private actor EventWriter {
    @discardableResult
    func write(_ event: HelperEvent) -> Bool {
        guard let data = try? JSONEncoder().encode(event), data.count <= maxProtocolLineBytes else { return false }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
        return true
    }
}

private func isCompactScript(_ character: Character) -> Bool {
    character.unicodeScalars.contains { scalar in
        switch scalar.value {
        case 0x3400...0x4DBF, 0x4E00...0x9FFF, 0x20000...0x2FA1F,
             0x3040...0x30FF, 0x31F0...0x31FF, 0xFF65...0xFF9F:
            return true
        default:
            return false
        }
    }
}

private func isPunctuationOrSeparator(_ character: Character) -> Bool {
    character.unicodeScalars.allSatisfy { scalar in
        switch scalar.properties.generalCategory {
        case .connectorPunctuation, .dashPunctuation, .openPunctuation, .closePunctuation,
             .initialPunctuation, .finalPunctuation, .otherPunctuation,
             .spaceSeparator, .lineSeparator, .paragraphSeparator:
            return true
        default:
            return false
        }
    }
}

private func opensWithoutSpace(_ character: Character) -> Bool {
    character.unicodeScalars.contains { scalar in
        switch scalar.properties.generalCategory {
        case .openPunctuation, .initialPunctuation:
            return true
        default:
            return false
        }
    }
}

private func closesWithoutSpace(_ character: Character) -> Bool {
    character.unicodeScalars.contains { scalar in
        switch scalar.properties.generalCategory {
        case .closePunctuation, .finalPunctuation, .otherPunctuation:
            return true
        default:
            return false
        }
    }
}

private func joinTranscript(_ draft: String, _ transcript: String) -> String {
    guard let left = draft.last, let right = transcript.first else {
        return draft + transcript
    }
    if left.isWhitespace || right.isWhitespace {
        return draft + transcript
    }
    let leftContent = draft.reversed().first { !isPunctuationOrSeparator($0) } ?? left
    let rightContent = transcript.first { !isPunctuationOrSeparator($0) } ?? right
    let compactBoundary =
        (isCompactScript(leftContent) && isCompactScript(rightContent)) ||
        opensWithoutSpace(left) ||
        closesWithoutSpace(right)
    return compactBoundary ? draft + transcript : draft + " " + transcript
}

private final class TranscriptState: @unchecked Sendable {
    private struct Segment {
        let range: CMTimeRange
        let text: String
        var final: Bool
    }

    private let lock = NSLock()
    private var segments: [Segment] = []

    func update(range: CMTimeRange, finalizationTime: CMTime, text: String) -> String {
        lock.lock()
        defer { lock.unlock() }

        segments.removeAll { segment in
            !segment.final && rangesOverlap(segment.range, range)
        }
        for index in segments.indices where endsAtOrBefore(segments[index].range, finalizationTime) {
            segments[index].final = true
        }
        segments.append(Segment(
            range: range,
            text: bounded(text),
            final: endsAtOrBefore(range, finalizationTime)
        ))
        segments.sort { CMTimeCompare($0.range.start, $1.range.start) < 0 }
        return assembled()
    }

    func current() -> String {
        lock.lock()
        defer { lock.unlock() }
        return assembled()
    }

    private func assembled() -> String {
        bounded(segments.map(\.text).reduce("", joinTranscript))
    }
}

private final class LevelMeter: @unchecked Sendable {
    private let lock = NSLock()
    private var startedAt: Double?
    private var lastEmission = 0.0

    func sample(_ buffer: AVAudioPCMBuffer) -> (elapsedMs: Int, level: Double)? {
        let now = ProcessInfo.processInfo.systemUptime
        lock.lock()
        defer { lock.unlock() }
        if startedAt == nil { startedAt = now }
        let elapsedMs = Int((now - (startedAt ?? now)) * 1_000)
        guard now - lastEmission >= 0.1 else { return nil }
        lastEmission = now
        guard let channels = buffer.floatChannelData else {
            return (elapsedMs, 0)
        }
        let frames = Int(buffer.frameLength)
        let channelCount = Int(buffer.format.channelCount)
        guard frames > 0, channelCount > 0 else {
            return (elapsedMs, 0)
        }
        var sum = 0.0
        for channel in 0..<channelCount {
            let samples = channels[channel]
            for frame in 0..<frames {
                let value = Double(samples[frame])
                sum += value * value
            }
        }
        let rms = sqrt(sum / Double(frames * channelCount))
        return (elapsedMs, min(1, max(0, rms)))
    }
}

private final class AudioInputConverter: @unchecked Sendable {
    private let outputFormat: AVAudioFormat
    private let converter: AVAudioConverter?

    init(inputFormat: AVAudioFormat, outputFormat: AVAudioFormat) {
        self.outputFormat = outputFormat
        self.converter = inputFormat == outputFormat ? nil : AVAudioConverter(from: inputFormat, to: outputFormat)
    }

    func convert(_ input: AVAudioPCMBuffer) throws -> AnalyzerInput {
        guard let converter else { return AnalyzerInput(buffer: input) }
        let ratio = outputFormat.sampleRate / input.format.sampleRate
        let capacity = AVAudioFrameCount(max(1, ceil(Double(input.frameLength) * ratio) + 1))
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
            throw ConversionError.outputAllocation
        }
        var supplied = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, outputStatus in
            guard !supplied else {
                outputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            outputStatus.pointee = .haveData
            return input
        }
        guard status != .error, conversionError == nil, output.frameLength > 0 else {
            throw ConversionError.failed
        }
        return AnalyzerInput(buffer: output)
    }

    private enum ConversionError: Error {
        case failed
        case outputAllocation
    }
}

@main
private enum PigeSpeech {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard #available(macOS 26.0, *) else {
            await writeProbe(status: "unsupported", reason: "service_unavailable")
            return
        }
        if arguments.count == 1, arguments[0] == "--self-test" {
            await selfTest()
            return
        }
        if arguments.count == 2, arguments[0] == "--probe" {
            await probe(languageTag: arguments[1])
            return
        }
        guard arguments.count == 3, arguments[0] == "--session" else {
            Foundation.exit(2)
        }
        await runSession(sessionId: arguments[1], languageTag: arguments[2])
    }

    private static func selfTest() async {
        let transcript = TranscriptState()
        let first = transcript.update(
            range: CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 1_000)),
            finalizationTime: .zero,
            text: "Hello."
        )
        let second = transcript.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 1, preferredTimescale: 1_000),
            text: "Next"
        )
        let final = transcript.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 2, preferredTimescale: 1_000),
            text: "Next!"
        )
        let cjk = TranscriptState()
        _ = cjk.update(
            range: CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 1_000)),
            finalizationTime: .zero,
            text: "你好"
        )
        let cjkJoined = cjk.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 1, preferredTimescale: 1_000),
            text: "世界"
        )
        let cjkPunctuation = TranscriptState()
        _ = cjkPunctuation.update(
            range: CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 1_000)),
            finalizationTime: .zero,
            text: "你好。"
        )
        let cjkPunctuationJoined = cjkPunctuation.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 1, preferredTimescale: 1_000),
            text: "世界"
        )
        let japanese = TranscriptState()
        _ = japanese.update(
            range: CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 1_000)),
            finalizationTime: .zero,
            text: "こんにちは。"
        )
        let japaneseJoined = japanese.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 1, preferredTimescale: 1_000),
            text: "次です"
        )
        let korean = TranscriptState()
        _ = korean.update(
            range: CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 1_000)),
            finalizationTime: .zero,
            text: "안녕하세요"
        )
        let koreanJoined = korean.update(
            range: CMTimeRange(
                start: CMTime(seconds: 1, preferredTimescale: 1_000),
                duration: CMTime(seconds: 1, preferredTimescale: 1_000)
            ),
            finalizationTime: CMTime(seconds: 1, preferredTimescale: 1_000),
            text: "반갑습니다"
        )
        let boundedCJK = bounded(String(repeating: "界", count: maxTranscriptUTF16Units))
        let boundedEmoji = bounded(String(repeating: "🙂", count: maxTranscriptUTF16Units))
        let lineBounded = boundedCJK.utf16.count == maxTranscriptUTF16Units &&
            boundedCJK.utf8.count == maxTranscriptUTF8Bytes &&
            boundedEmoji.utf16.count == maxTranscriptUTF16Units &&
            boundedEmoji.utf8.count == 64_000
        let passed = first == "Hello." && second == "Hello. Next" && final == "Hello. Next!" &&
            cjkJoined == "你好世界" && cjkPunctuationJoined == "你好。世界" &&
            japaneseJoined == "こんにちは。次です" && koreanJoined == "안녕하세요 반갑습니다" &&
            lineBounded
        let writer = EventWriter()
        await writer.write(HelperEvent(
            protocolVersion: protocolVersion,
            kind: "self_test",
            sessionId: nil,
            status: passed ? "passed" : "failed",
            reason: nil,
            permission: nil,
            transcript: nil,
            metering: nil,
            elapsedMs: nil,
            level: nil
        ))
    }

    @available(macOS 26.0, *)
    private static func probe(languageTag: String) async {
        let permission = microphonePermissionState()
        guard SpeechTranscriber.isAvailable else {
            await writeProbe(status: "unsupported", reason: "service_unavailable", permission: permission)
            return
        }
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: languageTag)) else {
            await writeProbe(status: "unsupported", reason: "language_unavailable", permission: permission)
            return
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
        let status = await AssetInventory.status(forModules: [transcriber])
        guard status == .installed else {
            await writeProbe(status: "unsupported", reason: "assets_unavailable", permission: permission)
            return
        }
        await writeProbe(status: "supported", reason: nil, permission: permission)
    }

    @available(macOS 26.0, *)
    private static func runSession(sessionId: String, languageTag: String) async {
        let writer = EventWriter()
        let permission = await requestMicrophonePermissionIfNeeded()
        guard permission == "granted" else {
            await writer.write(event(
                kind: "blocked",
                sessionId: sessionId,
                reason: permission == "restricted" ? "permission_restricted" : "permission_denied"
            ))
            return
        }
        guard SpeechTranscriber.isAvailable,
              let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: languageTag)) else {
            await writer.write(event(kind: "failed", sessionId: sessionId))
            return
        }
        let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
        guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
            await writer.write(event(kind: "failed", sessionId: sessionId))
            return
        }
        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let naturalFormat = inputNode.inputFormat(forBus: 0)
        guard naturalFormat.sampleRate > 0,
              naturalFormat.channelCount > 0,
              let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
                compatibleWith: [transcriber],
                considering: naturalFormat
              ) else {
            await writer.write(event(kind: "failed", sessionId: sessionId))
            return
        }

        let (inputSequence, inputContinuation) = AsyncStream.makeStream(of: AnalyzerInput.self)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let inputConverter = AudioInputConverter(inputFormat: naturalFormat, outputFormat: analyzerFormat)
        let transcript = TranscriptState()
        let meter = LevelMeter()
        let resultsTask = Task {
            do {
                for try await result in transcriber.results {
                    let text = String(result.text.characters)
                    let current = transcript.update(
                        range: result.range,
                        finalizationTime: result.resultsFinalizationTime,
                        text: text
                    )
                    if !(await writer.write(event(kind: "transcript", sessionId: sessionId, transcript: current))) {
                        await writer.write(event(kind: "failed", sessionId: sessionId))
                        return
                    }
                }
            } catch {
                await writer.write(event(kind: "failed", sessionId: sessionId))
            }
        }
        do {
            try await analyzer.prepareToAnalyze(in: analyzerFormat)
            inputNode.installTap(onBus: 0, bufferSize: 4_096, format: naturalFormat) { buffer, _ in
                do {
                    inputContinuation.yield(try inputConverter.convert(buffer))
                } catch {
                    Task { await writer.write(event(kind: "failed", sessionId: sessionId)) }
                }
                if let measurement = meter.sample(buffer) {
                    Task {
                        await writer.write(event(
                            kind: "meter",
                            sessionId: sessionId,
                            elapsedMs: measurement.elapsedMs,
                            level: measurement.level
                        ))
                    }
                }
            }
            audioEngine.prepare()
            try audioEngine.start()
            try await analyzer.start(inputSequence: inputSequence)
            await writer.write(event(kind: "ready", sessionId: sessionId, metering: "available"))
        } catch {
            inputNode.removeTap(onBus: 0)
            inputContinuation.finish()
            resultsTask.cancel()
            await analyzer.cancelAndFinishNow()
            await writer.write(event(kind: "failed", sessionId: sessionId))
            return
        }

        while let line = readLine(), let data = line.data(using: .utf8), data.count <= 4_096 {
            guard let command = try? JSONDecoder().decode(SessionCommand.self, from: data),
                  command.sessionId == sessionId else { continue }
            if command.operation == "cancel" {
                audioEngine.stop()
                inputNode.removeTap(onBus: 0)
                inputContinuation.finish()
                resultsTask.cancel()
                await analyzer.cancelAndFinishNow()
                return
            }
            if command.operation == "stop" {
                audioEngine.stop()
                inputNode.removeTap(onBus: 0)
                inputContinuation.finish()
                do {
                    try await analyzer.finalizeAndFinishThroughEndOfInput()
                    _ = await resultsTask.result
                    if !(await writer.write(event(kind: "final", sessionId: sessionId, transcript: transcript.current()))) {
                        await writer.write(event(kind: "failed", sessionId: sessionId))
                    }
                } catch {
                    resultsTask.cancel()
                    await writer.write(event(kind: "failed", sessionId: sessionId))
                }
                return
            }
        }

        audioEngine.stop()
        inputNode.removeTap(onBus: 0)
        inputContinuation.finish()
        resultsTask.cancel()
        await analyzer.cancelAndFinishNow()
    }

    private static func writeProbe(status: String, reason: String?, permission: String? = nil) async {
        let writer = EventWriter()
        await writer.write(HelperEvent(
            protocolVersion: protocolVersion,
            kind: "probe",
            sessionId: nil,
            status: status,
            reason: reason,
            permission: permission,
            transcript: nil,
            metering: nil,
            elapsedMs: nil,
            level: nil
        ))
    }

    private static func event(
        kind: String,
        sessionId: String,
        transcript: String? = nil,
        reason: String? = nil,
        metering: String? = nil,
        elapsedMs: Int? = nil,
        level: Double? = nil
    ) -> HelperEvent {
        HelperEvent(
            protocolVersion: protocolVersion,
            kind: kind,
            sessionId: sessionId,
            status: nil,
            reason: reason,
            permission: nil,
            transcript: transcript.map(bounded),
            metering: metering,
            elapsedMs: elapsedMs,
            level: level
        )
    }
}

private func microphonePermissionState() -> String {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return "granted"
    case .notDetermined: return "not-determined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    @unknown default: return "restricted"
    }
}

private func requestMicrophonePermissionIfNeeded() async -> String {
    let current = microphonePermissionState()
    guard current == "not-determined" else { return current }
    return await AVCaptureDevice.requestAccess(for: .audio) ? "granted" : "denied"
}

private func endsAtOrBefore(_ range: CMTimeRange, _ time: CMTime) -> Bool {
    range.isValid && time.isValid && CMTimeCompare(CMTimeRangeGetEnd(range), time) <= 0
}

private func rangesOverlap(_ left: CMTimeRange, _ right: CMTimeRange) -> Bool {
    guard left.isValid, right.isValid else { return false }
    let intersection = CMTimeRangeGetIntersection(left, otherRange: right)
    return intersection.isValid && CMTimeCompare(intersection.duration, .zero) > 0
}

private func bounded(_ value: String) -> String {
    var result = ""
    var utf16Units = 0
    var utf8Bytes = 0
    for character in value.precomposedStringWithCanonicalMapping {
        let original = String(character)
        let safe = original.unicodeScalars.allSatisfy { scalar in
            scalar.value >= 0x20 || scalar == "\n" || scalar == "\t"
        } ? original : " "
        let nextUTF16Units = safe.utf16.count
        let nextBytes = safe.lengthOfBytes(using: .utf8)
        guard utf16Units + nextUTF16Units <= maxTranscriptUTF16Units else { break }
        guard utf8Bytes + nextBytes <= maxTranscriptUTF8Bytes else { break }
        result.append(safe)
        utf16Units += nextUTF16Units
        utf8Bytes += nextBytes
    }
    return result
}
