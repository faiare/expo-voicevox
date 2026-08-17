import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Voicevox from 'expo-voicevox';
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

import { prepareVoicevoxAssets, type PreparedVoicevoxAssets } from './src/prepareVoicevoxAssets';

/** トーク合成に使えるのは talk 系のスタイルのみ。 */
const TALK_STYLE_TYPES = ['talk', 'streaming_talk'];

export default function App() {
  const [version, setVersion] = useState<string | null>(null);
  const [assets, setAssets] = useState<PreparedVoicevoxAssets | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [characters, setCharacters] = useState<Voicevox.VoicevoxCharacter[]>([]);
  const [styleId, setStyleId] = useState<number | null>(null);
  const [text, setText] = useState('こんにちは。expo-voicevox から喋っています。');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = useAudioPlayer(null);

  useEffect(() => {
    // 消音スイッチが入っていても鳴るようにしておく（iOS）。
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
      // 失敗しても合成自体の確認はできるので無視する。
    });
  }, []);

  useEffect(() => {
    // ここで例外が出るならネイティブライブラリのリンク・ロードに失敗している。
    try {
      setVersion(Voicevox.getVersion());
    } catch (e) {
      setError(describeError(e));
    }
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

  const handlePrepareAssets = useCallback(
    () =>
      withBusy('アセットを展開しています…', async () => {
        const prepared = await prepareVoicevoxAssets((progress) => {
          setStatus(`アセットを展開しています… ${progress.completed}/${progress.total} ${progress.current}`);
        });
        setAssets(prepared);
        setStatus('アセットの展開が完了しました');
      }),
    [withBusy]
  );

  const handleInitialize = useCallback(
    () =>
      withBusy('初期化しています…', async () => {
        if (!assets) {
          throw new Error('先にアセットを展開してください');
        }
        await Voicevox.initialize(assets);
        const loaded = await Voicevox.getCharacters();
        setCharacters(loaded);
        setStyleId(findDefaultStyleId(loaded));
        setInitialized(Voicevox.isInitialized());
        setStatus('初期化が完了しました');
      }),
    [assets, withBusy]
  );

  const handleSpeak = useCallback(
    () =>
      withBusy('合成しています…', async () => {
        if (styleId === null) {
          throw new Error('スタイルを選んでください');
        }
        const wavPath = await Voicevox.tts(text, styleId);
        player.replace({ uri: `file://${wavPath}` });
        player.play();
        setStatus(`合成しました: ${wavPath}`);
      }),
    [player, styleId, text, withBusy]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>expo-voicevox</Text>

        <Group name="1. ライブラリ">
          <Row label="voicevox-core" value={version ?? '（未取得）'} />
          <Row label="初期化済み" value={initialized ? 'はい' : 'いいえ'} />
        </Group>

        <Group name="2. アセット">
          <Text style={styles.note}>
            音声モデルと OpenJTalk 辞書をドキュメントディレクトリへ展開します。合計 160MB 前後あるので初回は時間がかかります。
          </Text>
          <Button title="アセットを展開" onPress={handlePrepareAssets} disabled={busy} />
          {assets ? <Row label="辞書" value={assets.openJtalkDictDir} /> : null}
        </Group>

        <Group name="3. 初期化">
          <Button
            title="initialize()"
            onPress={handleInitialize}
            disabled={busy || assets === null}
          />
        </Group>

        <Group name="4. 合成">
          <Text style={styles.label}>スタイル</Text>
          <View style={styles.styleList}>
            {characters.flatMap((character) =>
              character.styles
                .filter((style) => TALK_STYLE_TYPES.includes(style.type))
                .map((style) => (
                  <Pressable
                    key={style.id}
                    onPress={() => setStyleId(style.id)}
                    style={[styles.chip, style.id === styleId && styles.chipSelected]}>
                    <Text style={style.id === styleId ? styles.chipTextSelected : styles.chipText}>
                      {character.name} / {style.name}
                    </Text>
                  </Pressable>
                ))
            )}
            {characters.length === 0 ? (
              <Text style={styles.note}>初期化するとスタイルが表示されます</Text>
            ) : null}
          </View>

          <Text style={styles.label}>テキスト</Text>
          <TextInput style={styles.input} value={text} onChangeText={setText} multiline />
          <Button
            title="合成して再生"
            onPress={handleSpeak}
            disabled={busy || styleId === null}
          />
        </Group>

        <Group name="状態">
          {busy ? <ActivityIndicator /> : null}
          {status ? <Text style={styles.note}>{status}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
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

function Group(props: { name: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupHeader}>{props.name}</Text>
      {props.children}
    </View>
  );
}

function Row(props: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{props.label}</Text>
      <Text style={styles.value} numberOfLines={2}>
        {props.value}
      </Text>
    </View>
  );
}

function Button(props: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.button, props.disabled && styles.buttonDisabled]}>
      <Text style={styles.buttonText}>{props.title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eee' },
  content: { paddingBottom: 40 },
  header: { fontSize: 30, margin: 20 },
  group: { margin: 20, marginBottom: 0, backgroundColor: '#fff', borderRadius: 10, padding: 20 },
  groupHeader: { fontSize: 20, marginBottom: 12 },
  row: { marginBottom: 8 },
  label: { fontSize: 13, color: '#666', marginBottom: 4 },
  value: { fontSize: 15 },
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
  styleList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { borderWidth: 1, borderColor: '#ccc', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipSelected: { backgroundColor: '#2a6', borderColor: '#2a6' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextSelected: { fontSize: 13, color: '#fff' },
  button: {
    backgroundColor: '#36c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { backgroundColor: '#aab' },
  buttonText: { color: '#fff', fontSize: 15 },
  credits: { margin: 20, marginTop: 12 },
  creditsText: { fontSize: 11, color: '#888' },
});
