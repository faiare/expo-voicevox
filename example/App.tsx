import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Voicevox from '@faiare/expo-voicevox';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/** トーク合成に使えるのは talk 系のスタイルのみ。 */
const TALK_STYLE_TYPES = ['talk', 'streaming_talk'];

const WORD_TYPES: Voicevox.VoicevoxUserDictWordType[] = [
  'COMMON_NOUN',
  'PROPER_NOUN',
  'VERB',
  'ADJECTIVE',
  'SUFFIX',
];

/** AudioQuery の調整対象。voicevox-core の既定値を初期値にしている。 */
const DEFAULT_PARAMS = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
};

type Params = typeof DEFAULT_PARAMS;

type MoraRef = { phrase: number; mora: number };

export default function App() {
  const [version, setVersion] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [characters, setCharacters] = useState<Voicevox.VoicevoxCharacter[]>([]);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [text, setText] = useState('こんにちは。expo-voicevox から喋っています。');
  const [kana, setKana] = useState("コンニチワ'");
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [upspeak, setUpspeak] = useState(true);
  const [phrases, setPhrases] = useState<Voicevox.VoicevoxAccentPhrase[]>([]);
  const [selectedMora, setSelectedMora] = useState<MoraRef | null>(null);
  const [words, setWords] = useState<Voicevox.VoicevoxUserDictWord[]>([]);
  const [surface, setSurface] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [accentType, setAccentType] = useState(0);
  const [priority, setPriority] = useState(5);
  const [wordType, setWordType] = useState<Voicevox.VoicevoxUserDictWordType>('PROPER_NOUN');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechState, setSpeechState] = useState('');
  const [directory, setDirectory] = useState<Voicevox.VoicevoxOutputDirectory>('cache');

  const player = useAudioPlayer(null);

  useEffect(() => {
    // 消音スイッチが入っていても鳴るようにしておく（iOS）。
    // これは expo-audio 経由（tts / synthesis がファイルへ書く方）の再生のためのもの。
    // speak() は audioSession オプションで自前に扱えるので、この設定に依存しない。
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
      // 失敗しても合成自体の確認はできるので無視する。
    });
  }, []);

  useEffect(() => {
    const subscription = Voicevox.addSpeechStateChangeListener(({ id, state, reason }) => {
      setSpeechState(reason ? `#${id} ${state}: ${reason}` : `#${id} ${state}`);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    // ここで例外が出るならネイティブライブラリのリンク・ロードに失敗している。
    try {
      setVersion(Voicevox.getVersion());
    } catch (e) {
      setError(describeError(e));
    }
  }, []);

  useEffect(() => {
    // Android は初回だけ APK 内のアセットを端末へ展開するので、その進捗を出す。
    // iOS はアプリのバンドルをそのまま読むためイベントは発生しない。
    const subscription = Voicevox.addPrepareProgressListener((progress) => {
      const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);
      const detail =
        progress.totalBytes > 0
          ? `${megabytes(progress.completedBytes)}/${megabytes(progress.totalBytes)}MB`
          : `${progress.completedFiles}/${progress.totalFiles}`;
      setStatus(`アセットを準備しています… ${progress.current} ${detail}`);
    });
    return () => subscription.remove();
  }, []);

  const withBusy = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(label);
    try {
      await action();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const play = useCallback(
    (wavPath: string) => {
      player.replace({ uri: `file://${wavPath}` });
      player.play();
      setStatus(`合成しました: ${wavPath}`);
    },
    [player]
  );

  const handlePrepareAssets = useCallback(
    () =>
      withBusy('アセットを準備しています…', async () => {
        const started = Date.now();
        try {
          const paths = await Voicevox.prepareAssets();
          setStatus(
            `${Date.now() - started}ms\n辞書: ${paths.openJtalkDictDir}\n` +
              `モデル: ${paths.voiceModelPaths.join(', ')}`
          );
        } catch (e) {
          // 中断は失敗ではないので、通信エラーと同じ扱いにしない。
          if (!Voicevox.isPrepareAssetsCancelled(e)) {
            throw e;
          }
          setStatus(`アセットの準備を中断しました（${Date.now() - started}ms）`);
        }
      }),
    [withBusy]
  );

  const handleAssetStatus = useCallback(
    () =>
      withBusy('アセットの状態を読んでいます…', async () => {
        const status = await Voicevox.getAssetStatus();
        setStatus(
          `configured: ${status.configured} / ready: ${status.ready} / ` +
            `assetSource: ${status.assetSource} / ` +
            `downloadBytes: ${Math.round(status.downloadBytes / 1024 / 1024)}MB`
        );
      }),
    [withBusy]
  );

  // 準備の実行中に押せる必要があるので、busy でも disabled にしない。
  const handleCancelPrepare = useCallback(() => {
    Voicevox.cancelPrepareAssets();
  }, []);

  const handleInitialize = useCallback(
    () =>
      withBusy('初期化しています…', async () => {
        // 引数なし。app.json の config plugin が配置した辞書とモデルを自動で解決する。
        await Voicevox.initialize();
        const loaded = await Voicevox.getCharacters();
        setCharacters(loaded);
        setStyleId(findDefaultStyleId(loaded));
        setInitialized(Voicevox.isInitialized());
        setStatus('初期化が完了しました');
      }),
    [withBusy]
  );

  const handleFinalize = useCallback(
    () =>
      withBusy('破棄しています…', async () => {
        await Voicevox.finalize();
        setInitialized(Voicevox.isInitialized());
        setCharacters([]);
        setPhrases([]);
        setSelectedMora(null);
        // ユーザー辞書は finalize をまたいで残るので words はそのままにする。
        setStatus('Synthesizer を破棄しました（辞書は残っています）');
      }),
    [withBusy]
  );

  const handleSpeak = useCallback(
    () =>
      withBusy('合成しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        // createAudioQuery で作り、パラメータを書き換えてから synthesis に渡す。
        const query = await Voicevox.createAudioQuery(text, styleId);
        play(await Voicevox.synthesis(applyParams(query, params), styleId, {
          enableInterrogativeUpspeak: upspeak,
          directory,
        }));
      }),
    [directory, play, params, styleId, text, upspeak, withBusy]
  );

  const handleSpeakFromKana = useCallback(
    () =>
      withBusy('合成しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        const query = await Voicevox.createAudioQueryFromKana(kana, styleId);
        play(await Voicevox.synthesis(applyParams(query, params), styleId, {
          enableInterrogativeUpspeak: upspeak,
          directory,
        }));
      }),
    [directory, kana, params, play, styleId, upspeak, withBusy]
  );

  const handleSpeakOnDemand = useCallback(
    () =>
      withBusy('合成して再生しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        // speak() はファイルを 1 つも作らない。メモリ上の WAV をそのままネイティブで鳴らす。
        // audioSession: 'exclusive' にすると、setAudioModeAsync を使わなくても
        // iOS の消音スイッチを越えて鳴る。
        const utterance = await Voicevox.speak(text, styleId, {
          enableInterrogativeUpspeak: upspeak,
          audioSession: 'exclusive',
        });
        if (!utterance.started) {
          setStatus('追い越されたので鳴らしませんでした');
          return;
        }
        setStatus(`再生中 #${utterance.id}（${utterance.durationMillis}ms）`);
        // 鳴り終わりは busy の外で待つ。speak() が返った時点で UI は操作可能にしておきたい
        // （待っているあいだも stopSpeaking() を押せるように）。
        Voicevox.waitForSpeech(utterance.id).then((ended) => {
          setStatus(`#${utterance.id} ${ended}`);
        });
      }),
    [styleId, text, upspeak, withBusy]
  );

  // AudioQuery を組み立てずに話速と頭出しを変える。ネイティブが createAudioQuery を挟むが、
  // 言語解析だけで音響モデルの推論は入らないので増えるのは数十 ms。
  const handleSpeakFaster = useCallback(
    () =>
      withBusy('合成して再生しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        const started = Date.now();
        const utterance = await Voicevox.speak(text, styleId, {
          enableInterrogativeUpspeak: upspeak,
          audioSession: 'exclusive',
          speedScale: 1.1,
          prePhonemeLength: 0,
        });
        setStatus(
          `speedScale 1.1 / prePhonemeLength 0（合成 ${Date.now() - started}ms / ` +
            `再生 ${utterance.durationMillis}ms）`
        );
      }),
    [styleId, text, upspeak, withBusy]
  );

  const handleStopSpeaking = useCallback(
    () =>
      withBusy('停止しています…', async () => {
        await Voicevox.stopSpeaking();
        setStatus(`停止しました（isSpeaking: ${Voicevox.isSpeaking()}）`);
      }),
    [withBusy]
  );

  // キャッシュが効いているかは合成にかかる時間でしか分からないので、同じ入力を 2 回続けて測る。
  const handleMeasureCache = useCallback(
    () =>
      withBusy('キャッシュの効きを測っています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        await Voicevox.clearSynthesisCache();

        const coldStart = Date.now();
        await Voicevox.tts(text, styleId, { enableInterrogativeUpspeak: upspeak });
        const cold = Date.now() - coldStart;

        const warmStart = Date.now();
        await Voicevox.tts(text, styleId, { enableInterrogativeUpspeak: upspeak });
        const warm = Date.now() - warmStart;

        const stats = await Voicevox.getSynthesisCacheStats();
        setStatus(
          `1 回目 ${cold}ms / 2 回目 ${warm}ms（hits ${stats.hits} / misses ${stats.misses} / ` +
            `${stats.entryCount} 件 ${Math.round(stats.bytes / 1024)}KB）`
        );
      }),
    [styleId, text, upspeak, withBusy]
  );

  // 押した瞬間に喋らせたい画面のための「先に合成だけしておく」経路。
  const handlePrecache = useCallback(
    () =>
      withBusy('先に合成しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        await Voicevox.clearSynthesisCache();

        const precacheStart = Date.now();
        await Voicevox.precacheSpeech(text, styleId, { enableInterrogativeUpspeak: upspeak });
        const precache = Date.now() - precacheStart;

        const speakStart = Date.now();
        const utterance = await Voicevox.speak(text, styleId, {
          enableInterrogativeUpspeak: upspeak,
          audioSession: 'exclusive',
        });
        setStatus(
          `precacheSpeech ${precache}ms → speak ${Date.now() - speakStart}ms` +
            `（started: ${utterance.started}）`
        );
      }),
    [styleId, text, upspeak, withBusy]
  );

  const handleCacheStats = useCallback(
    () =>
      withBusy('キャッシュの状態を読んでいます…', async () => {
        const stats = await Voicevox.getSynthesisCacheStats();
        setStatus(
          `${stats.entryCount} 件 / ${Math.round(stats.bytes / 1024)}KB ` +
            `（上限 ${Math.round(stats.limitBytes / 1024 / 1024)}MB / hits ${stats.hits} / ` +
            `misses ${stats.misses}）`
        );
      }),
    [withBusy]
  );

  const handleClearCache = useCallback(
    () =>
      withBusy('キャッシュを捨てています…', async () => {
        await Voicevox.clearSynthesisCache();
        setStatus('キャッシュを捨てました');
      }),
    [withBusy]
  );

  const handleLoadPhrases = useCallback(
    () =>
      withBusy('アクセント句を取得しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        setPhrases(await Voicevox.createAccentPhrases(text, styleId));
        setSelectedMora(null);
        setStatus('アクセント句を取得しました');
      }),
    [styleId, text, withBusy]
  );

  /** アクセント位置を変えたので、読み方を voicevox-core に付け直させる。 */
  const handleRegenerateMoraData = useCallback(
    () =>
      withBusy('読み直しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        setPhrases(await Voicevox.replaceMoraData(phrases, styleId));
        setStatus('音素長と音高を生成し直しました');
      }),
    [phrases, styleId, withBusy]
  );

  const handleSpeakPhrases = useCallback(
    () =>
      withBusy('合成しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        // 編集したアクセント句をそのまま AudioQuery へ。replaceMoraData は呼ばない
        // （呼ぶと手で変えた音高が上書きされる）。
        const query = await Voicevox.audioQueryFromAccentPhrases(phrases);
        play(await Voicevox.synthesis(applyParams(query, params), styleId, {
          enableInterrogativeUpspeak: upspeak,
        }));
      }),
    [params, phrases, play, styleId, upspeak, withBusy]
  );

  const applyWords = useCallback(
    (next: Voicevox.VoicevoxUserDictWord[]) =>
      withBusy('辞書を更新しています…', async () => {
        // 全置換。呼ぶたびに辞書を作り直して OpenJTalk へ適用し直される。
        await Voicevox.setUserDictWords(next);
        setWords(next);
        setStatus(`ユーザー辞書を更新しました（${next.length} 語）`);
      }),
    [withBusy]
  );

  // iOS のシミュレータへは日本語を打ち込めない。placeholder と同じ値を入れて
  // 辞書の登録経路を一通り試せるようにしておく。
  const handleFillSampleWord = useCallback(() => {
    setSurface('四国めたん');
    setPronunciation('シコクメタン');
    setAccentType(0);
    setWordType('PROPER_NOUN');
  }, []);

  const handleAddWord = useCallback(() => {
    if (surface.length === 0 || pronunciation.length === 0) {
      setError('表記と読みを入力してください');
      return;
    }
    applyWords([...words, { surface, pronunciation, accentType, wordType, priority }]);
    setSurface('');
    setPronunciation('');
    setAccentType(0);
  }, [accentType, applyWords, priority, pronunciation, surface, wordType, words]);

  const selected =
    selectedMora !== null ? phrases[selectedMora.phrase]?.moras[selectedMora.mora] : undefined;

  return (
    <SafeAreaView style={styles.container}>
      {/*
        実行中かどうかと直前の結果は、スクロール位置に関係なく常に見えるようにしておく。
        ScrollView の外に置いてレイアウトを占有させるので、Android の dev トーストや
        ソフトキーボード（どちらも画面下部に出る）と重ならない。
      */}
      <View testID="status-bar" style={styles.statusBar}>
        <View style={styles.statusRow}>
          <Text testID="status-busy" style={styles.statusBadge}>
            {busy ? 'BUSY' : 'IDLE'}
          </Text>
          <Text testID="status-initialized" style={styles.statusBadge}>
            {initialized ? '初期化: はい' : '初期化: いいえ'}
          </Text>
          {busy ? <ActivityIndicator /> : null}
        </View>
        <Text testID="status-text" style={[styles.note, styles.statusText]} numberOfLines={4}>
          {status || '—'}
        </Text>
        {error ? (
          <Text testID="status-error" style={styles.error} numberOfLines={4}>
            {error}
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.header}>expo-voicevox</Text>

        <Group testID="section-lib" name="1. ライブラリ">
          <Row testID="lib-version" label="voicevox-core" value={version ?? '（未取得）'} />
          <Row testID="lib-initialized" label="初期化済み" value={initialized ? 'はい' : 'いいえ'} />
        </Group>

        <Group testID="section-init" name="2. 初期化">
          <Text style={styles.note}>
            音声モデルと OpenJTalk 辞書は app.json の expo-voicevox plugin が prebuild
            時に埋め込んでいます。Android は初回のみ端末への展開が走ります。
          </Text>
          <Button
            testID="btn-asset-status"
            title="getAssetStatus()"
            onPress={handleAssetStatus}
            disabled={busy}
          />
          <Button
            testID="btn-prepare-assets"
            title="prepareAssets()"
            onPress={handlePrepareAssets}
            disabled={busy}
          />
          {/* 準備中に押すためのボタンなので busy では止めない。 */}
          <Button
            testID="btn-cancel-prepare"
            title="cancelPrepareAssets()"
            onPress={handleCancelPrepare}
          />
          <Button
            testID="btn-initialize"
            title="initialize()"
            onPress={handleInitialize}
            disabled={busy}
          />
          <Button
            testID="btn-finalize"
            title="finalize()"
            onPress={handleFinalize}
            disabled={busy || !initialized}
            variant="secondary"
          />
        </Group>

        <Group testID="section-synth" name="3. 合成">
          <Text style={styles.label}>スタイル</Text>
          <View style={styles.styleList}>
            {characters.flatMap((character) =>
              character.styles
                .filter((style) => TALK_STYLE_TYPES.includes(style.type))
                .map((style) => (
                  <Chip
                    key={style.id}
                    testID={`style-chip-${style.id}`}
                    label={`${character.name} / ${style.name}`}
                    selected={style.id === styleId}
                    onPress={() => setStyleId(style.id)}
                  />
                ))
            )}
            {characters.length === 0 ? (
              <Text style={styles.note}>初期化するとスタイルが表示されます</Text>
            ) : null}
          </View>

          <Text style={styles.label}>テキスト</Text>
          <TextInput
            testID="input-text"
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Text style={styles.label}>WAV の書き出し先</Text>
          <View style={styles.styleList}>
            <Chip
              testID="dir-chip-cache"
              label="cache（既定）"
              selected={directory === 'cache'}
              onPress={() => setDirectory('cache')}
            />
            <Chip
              testID="dir-chip-document"
              label="document"
              selected={directory === 'document'}
              onPress={() => setDirectory('document')}
            />
          </View>
          <Button
            testID="btn-synthesize-play"
            title="合成して再生"
            onPress={handleSpeak}
            disabled={busy || styleId === null}
          />
          <Text style={styles.note}>
            上は synthesis() でキャッシュへ WAV を書き、そのパスを expo-audio に渡しています。
            下の speak() はファイルを作らず、メモリ上の WAV をネイティブでそのまま鳴らします。
          </Text>
          <Button
            testID="btn-speak"
            title="speak() で再生（ファイルを作らない）"
            onPress={handleSpeakOnDemand}
            disabled={busy || styleId === null}
          />
          <Button
            testID="btn-speak-faster"
            title="speak() で再生（speedScale 1.1 / prePhonemeLength 0）"
            onPress={handleSpeakFaster}
            disabled={busy || styleId === null}
          />
          {/* 再生中は busy になるので、停止だけは busy でも押せるようにしておく。 */}
          <Button testID="btn-stop-speaking" title="stopSpeaking()" onPress={handleStopSpeaking} />
          {speechState ? (
            <Text testID="speech-state" style={styles.note}>
              再生状態: {speechState}
            </Text>
          ) : null}
        </Group>

        <Group testID="section-params" name="4. 合成パラメータ">
          <Text style={styles.note}>
            createAudioQuery() で作った AudioQuery を書き換えてから synthesis() に渡します。
          </Text>
          <Stepper
            testID="param-speed"
            label="話速 speedScale"
            value={params.speedScale}
            step={0.1}
            min={0.5}
            max={2}
            onChange={(speedScale) => setParams({ ...params, speedScale })}
          />
          <Stepper
            testID="param-pitch"
            label="音高 pitchScale"
            value={params.pitchScale}
            step={0.01}
            min={-0.15}
            max={0.15}
            onChange={(pitchScale) => setParams({ ...params, pitchScale })}
          />
          <Stepper
            testID="param-intonation"
            label="抑揚 intonationScale"
            value={params.intonationScale}
            step={0.1}
            min={0}
            max={2}
            onChange={(intonationScale) => setParams({ ...params, intonationScale })}
          />
          <Stepper
            testID="param-volume"
            label="音量 volumeScale"
            value={params.volumeScale}
            step={0.1}
            min={0}
            max={2}
            onChange={(volumeScale) => setParams({ ...params, volumeScale })}
          />
          <Stepper
            testID="param-pre"
            label="開始の無音 prePhonemeLength（秒）"
            value={params.prePhonemeLength}
            step={0.05}
            min={0}
            max={1.5}
            onChange={(prePhonemeLength) => setParams({ ...params, prePhonemeLength })}
          />
          <Stepper
            testID="param-post"
            label="終了の無音 postPhonemeLength（秒）"
            value={params.postPhonemeLength}
            step={0.05}
            min={0}
            max={1.5}
            onChange={(postPhonemeLength) => setParams({ ...params, postPhonemeLength })}
          />
          <Toggle
            testID="param-upspeak"
            label="疑問文の語尾を上げる"
            value={upspeak}
            onChange={setUpspeak}
          />
          <Button
            testID="btn-params-reset"
            title="既定値に戻す"
            onPress={() => setParams(DEFAULT_PARAMS)}
            disabled={busy}
            variant="secondary"
          />
        </Group>

        <Group testID="section-accent" name="5. アクセントと音高">
          <Text style={styles.note}>
            上のテキストからアクセント句を取り出して編集します。数字はアクセント核の位置で、
            0 は平板です。モーラを選ぶと音高と長さを個別に変えられます。
          </Text>
          <Button
            testID="btn-accent-load"
            title="アクセント句を取得"
            onPress={handleLoadPhrases}
            disabled={busy || styleId === null}
          />

          {phrases.map((phrase, phraseIndex) => (
            <View
              key={phraseIndex}
              testID={`accent-phrase-${phraseIndex}`}
              style={styles.phrase}>
              <View style={styles.moraList}>
                {phrase.moras.map((mora, moraIndex) => (
                  <Chip
                    key={moraIndex}
                    testID={`mora-chip-${phraseIndex}-${moraIndex}`}
                    label={mora.text}
                    selected={
                      selectedMora?.phrase === phraseIndex && selectedMora?.mora === moraIndex
                    }
                    onPress={() => setSelectedMora({ phrase: phraseIndex, mora: moraIndex })}
                  />
                ))}
              </View>
              <Stepper
                testID={`accent-core-${phraseIndex}`}
                label="アクセント核"
                value={phrase.accent}
                step={1}
                min={0}
                max={phrase.moras.length}
                digits={0}
                onChange={(accent) =>
                  setPhrases(updatePhrase(phrases, phraseIndex, { ...phrase, accent }))
                }
              />
              <Toggle
                testID={`accent-interrogative-${phraseIndex}`}
                label="疑問形"
                value={phrase.isInterrogative}
                onChange={(isInterrogative) =>
                  setPhrases(updatePhrase(phrases, phraseIndex, { ...phrase, isInterrogative }))
                }
              />
            </View>
          ))}

          {selected && selectedMora ? (
            <View style={styles.phrase}>
              <Text testID="selected-mora-label" style={styles.label}>
                選択中のモーラ: {selected.text}
              </Text>
              <Stepper
                testID="selected-mora-pitch"
                label="音高 pitch"
                value={selected.pitch}
                step={0.1}
                min={0}
                max={10}
                onChange={(pitch) =>
                  setPhrases(updateMora(phrases, selectedMora, { ...selected, pitch }))
                }
              />
              <Stepper
                testID="selected-mora-length"
                label="母音の長さ vowelLength（秒）"
                value={selected.vowelLength}
                step={0.01}
                min={0}
                max={1}
                onChange={(vowelLength) =>
                  setPhrases(updateMora(phrases, selectedMora, { ...selected, vowelLength }))
                }
              />
            </View>
          ) : null}

          {phrases.length > 0 ? (
            <>
              <Button
                testID="btn-accent-replace-mora-data"
                title="読みを付け直す（replaceMoraData）"
                onPress={handleRegenerateMoraData}
                disabled={busy}
                variant="secondary"
              />
              <Button
                testID="btn-accent-speak"
                title="このアクセント句で合成して再生"
                onPress={handleSpeakPhrases}
                disabled={busy}
              />
            </>
          ) : null}
        </Group>

        <Group testID="section-dict" name="6. ユーザー辞書">
          <Text style={styles.note}>
            setUserDictWords() は全置換です。下のリストが唯一の状態で、変更のたびに丸ごと渡し直します。
            initialize() の前でも呼べます。
          </Text>

          <Text style={styles.label}>表記</Text>
          <TextInput
            testID="input-dict-surface"
            style={styles.inputSingle}
            value={surface}
            onChangeText={setSurface}
            placeholder="四国めたん"
          />
          <Text style={styles.label}>読み（全角カタカナ）</Text>
          <TextInput
            testID="input-dict-pronunciation"
            style={styles.inputSingle}
            value={pronunciation}
            onChangeText={setPronunciation}
            placeholder="シコクメタン"
          />
          <Text style={styles.label}>品詞</Text>
          <View style={styles.styleList}>
            {WORD_TYPES.map((type) => (
              <Chip
                key={type}
                testID={`wordtype-chip-${type}`}
                label={type}
                selected={type === wordType}
                onPress={() => setWordType(type)}
              />
            ))}
          </View>
          <Stepper
            testID="dict-accent"
            label="アクセント核 accentType"
            value={accentType}
            step={1}
            min={0}
            max={20}
            digits={0}
            onChange={setAccentType}
          />
          <Stepper
            testID="dict-priority"
            label="優先度 priority"
            value={priority}
            step={1}
            min={0}
            max={10}
            digits={0}
            onChange={setPriority}
          />
          <Text style={styles.note}>
            既定の辞書に無い語なら priority は既定の 5 で足ります。既にある語の読みを
            上書きしたいときは priority を上げてください（形態素解析のコスト勝負になります）。
          </Text>
          {/* iOS のシミュレータには日本語を送り込めないので、E2E から辞書を試せるようにしておく。 */}
          <Button
            testID="btn-dict-fill-sample"
            title="例を入れる"
            onPress={handleFillSampleWord}
            disabled={busy}
            variant="secondary"
          />
          <Button
            testID="btn-dict-add"
            title="登録する"
            onPress={handleAddWord}
            disabled={busy}
          />

          {words.map((word, index) => (
            <View key={index} style={styles.wordRow}>
              <Text testID={`dict-word-${index}`} style={styles.value}>
                {word.surface} → {word.pronunciation}（{word.wordType}, アクセント核{' '}
                {word.accentType}, 優先度 {word.priority}）
              </Text>
              <Pressable
                testID={`btn-dict-remove-${index}`}
                accessibilityRole="button"
                onPress={() => applyWords(words.filter((_, i) => i !== index))}
                disabled={busy}>
                <Text style={styles.remove}>削除</Text>
              </Pressable>
            </View>
          ))}
        </Group>

        <Group testID="section-kana" name="7. カナから合成">
          <Text style={styles.note}>
            AquesTalk 風記法。&apos; がアクセント核、_ が無声化、/ が句切り、？ が疑問形です。
          </Text>
          <TextInput
            testID="input-kana"
            style={styles.inputSingle}
            value={kana}
            onChangeText={setKana}
          />
          <Button
            testID="btn-kana-speak"
            title="カナで合成して再生"
            onPress={handleSpeakFromKana}
            disabled={busy || styleId === null}
          />
        </Group>

        <Group testID="section-cache" name="8. 合成キャッシュ">
          <Text style={styles.note}>
            同じテキスト・スタイル・オプションの組み合わせは、2 回目から合成をやり直しません。
            ユーザー辞書を変えると読みが変わるので、その時点で自動的に捨てられます。
          </Text>
          <Button
            testID="btn-cache-measure"
            title="キャッシュの効きを測る（同じ入力で 2 回合成）"
            onPress={handleMeasureCache}
            disabled={busy || styleId === null}
          />
          <Button
            testID="btn-cache-precache"
            title="precacheSpeech() で温めてから speak()"
            onPress={handlePrecache}
            disabled={busy || styleId === null}
          />
          <Button
            testID="btn-cache-stats"
            title="getSynthesisCacheStats()"
            onPress={handleCacheStats}
            disabled={busy}
          />
          <Button
            testID="btn-cache-clear"
            title="clearSynthesisCache()"
            onPress={handleClearCache}
            disabled={busy}
          />
        </Group>

        {/* VOICEVOX 音声モデル / ONNX Runtime の利用規約が求めるクレジット表記。 */}
        <View style={styles.credits}>
          <Text style={styles.creditsText}>Powered by VOICEVOX</Text>
          <Text style={styles.creditsText}>
            VOICEVOX:四国めたん / VOICEVOX:ずんだもん / VOICEVOX:春日部つむぎ / VOICEVOX:雨晴はう
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function applyParams(
  query: Voicevox.VoicevoxAudioQuery,
  params: Params
): Voicevox.VoicevoxAudioQuery {
  return { ...query, ...params };
}

function updatePhrase(
  phrases: Voicevox.VoicevoxAccentPhrase[],
  index: number,
  phrase: Voicevox.VoicevoxAccentPhrase
): Voicevox.VoicevoxAccentPhrase[] {
  return phrases.map((current, i) => (i === index ? phrase : current));
}

function updateMora(
  phrases: Voicevox.VoicevoxAccentPhrase[],
  ref: MoraRef,
  mora: Voicevox.VoicevoxMora
): Voicevox.VoicevoxAccentPhrase[] {
  return phrases.map((phrase, phraseIndex) =>
    phraseIndex === ref.phrase
      ? { ...phrase, moras: phrase.moras.map((current, i) => (i === ref.mora ? mora : current)) }
      : phrase
  );
}

function findDefaultStyleId(characters: Voicevox.VoicevoxCharacter[]): number | null {
  const talkStyles = characters.flatMap((character) =>
    character.styles.filter((style) => TALK_STYLE_TYPES.includes(style.type))
  );
  // ずんだもん（ノーマル）= 3 があればそれを既定にする。
  return talkStyles.find((style) => style.id === 3)?.id ?? talkStyles[0]?.id ?? null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function Group(props: { testID?: string; name: string; children: React.ReactNode }) {
  return (
    <View testID={props.testID} style={styles.group}>
      <Text style={styles.groupHeader}>{props.name}</Text>
      {props.children}
    </View>
  );
}

function Row(props: { testID?: string; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{props.label}</Text>
      <Text testID={props.testID} style={styles.value} numberOfLines={2}>
        {props.value}
      </Text>
    </View>
  );
}

function Button(props: {
  testID?: string;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const secondary = props.variant === 'secondary';
  return (
    <Pressable
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.button,
        secondary && styles.buttonSecondary,
        props.disabled && styles.buttonDisabled,
      ]}>
      <Text style={secondary ? styles.buttonTextSecondary : styles.buttonText}>{props.title}</Text>
    </Pressable>
  );
}

function Chip(props: { testID?: string; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={[styles.chip, props.selected && styles.chipSelected]}>
      <Text style={props.selected ? styles.chipTextSelected : styles.chipText}>{props.label}</Text>
    </Pressable>
  );
}

/**
 * 数値を増減する UI。
 *
 * スライダを使わないのは、example のためだけに依存を増やしたくないため。
 */
function Stepper(props: {
  testID?: string;
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  digits?: number;
  onChange: (value: number) => void;
}) {
  const digits = props.digits ?? 2;
  const move = (delta: number) => {
    const next = Math.min(props.max, Math.max(props.min, props.value + delta));
    // 0.1 刻みの加算で誤差が積もるので、桁を決めて丸める。
    props.onChange(Number(next.toFixed(digits)));
  };
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{props.label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          testID={props.testID ? `${props.testID}-minus` : undefined}
          accessibilityRole="button"
          onPress={() => move(-props.step)}
          style={styles.stepperButton}>
          <Text style={styles.stepperButtonText}>−</Text>
        </Pressable>
        {/* 値の Text は Pressable の兄弟。iOS で子 Text が親にマージされるのを避けるため。 */}
        <Text testID={props.testID ? `${props.testID}-value` : undefined} style={styles.stepperValue}>
          {props.value.toFixed(digits)}
        </Text>
        <Pressable
          testID={props.testID ? `${props.testID}-plus` : undefined}
          accessibilityRole="button"
          onPress={() => move(props.step)}
          style={styles.stepperButton}>
          <Text style={styles.stepperButtonText}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * ON / OFF を切り替える UI。
 *
 * 行ごと Pressable にすると、iOS ではラベルとバッジの Text が親へマージされて
 * アクセシビリティツリーから消える。タップ領域はバッジだけに絞ってある。
 */
function Toggle(props: {
  testID?: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{props.label}</Text>
      <Pressable
        testID={props.testID}
        accessibilityRole="switch"
        accessibilityState={{ checked: props.value }}
        onPress={() => props.onChange(!props.value)}
        style={[styles.toggle, props.value && styles.toggleOn]}>
        <Text
          testID={props.testID ? `${props.testID}-value` : undefined}
          style={props.value ? styles.toggleTextOn : styles.toggleText}>
          {props.value ? 'ON' : 'OFF'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  statusBar: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusText: { marginBottom: 0 },
  statusBadge: {
    fontSize: 12,
    color: '#333',
    backgroundColor: '#eee',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  content: { paddingBottom: 40 },
  header: { fontSize: 30, margin: 20 },
  group: { margin: 20, marginBottom: 0, backgroundColor: '#fff', borderRadius: 10, padding: 20 },
  groupHeader: { fontSize: 20, marginBottom: 12 },
  row: { marginBottom: 8 },
  label: { fontSize: 13, color: '#666', marginBottom: 4 },
  value: { fontSize: 15, flexShrink: 1 },
  note: { fontSize: 13, color: '#666', marginBottom: 12 },
  error: { fontSize: 13, color: '#c00' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    minHeight: 80,
    marginBottom: 12,
    fontSize: 15,
  },
  inputSingle: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  styleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  moraList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  phrase: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 12, marginTop: 12 },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },
  remove: { fontSize: 13, color: '#c00' },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: { backgroundColor: '#2a6', borderColor: '#2a6' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextSelected: { fontSize: 13, color: '#fff' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  stepperLabel: { fontSize: 13, color: '#666', flexShrink: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { fontSize: 16, color: '#333' },
  stepperValue: { fontSize: 15, minWidth: 52, textAlign: 'center' },
  toggle: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toggleOn: { backgroundColor: '#2a6', borderColor: '#2a6' },
  toggleText: { fontSize: 13, color: '#333' },
  toggleTextOn: { fontSize: 13, color: '#fff' },
  button: {
    backgroundColor: '#36c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#36c' },
  buttonDisabled: { backgroundColor: '#aab', borderColor: '#aab' },
  buttonText: { color: '#fff', fontSize: 15 },
  buttonTextSecondary: { color: '#36c', fontSize: 15 },
  credits: { margin: 20, marginTop: 12 },
  creditsText: { fontSize: 11, color: '#888' },
});
