/**
 * 日本語のキャラクター名・スタイル名 → `app.json` に書く半角英数の slug。
 *
 * `scripts/gen-vvm-catalog.mjs` がこの表と VVM リリースの README を突き合わせて
 * `catalog.generated.ts` を作る。**表に無い名前が 1 つでもあれば生成は失敗する**ので、
 * VVM のバージョンを上げたときの取りこぼしは黙って通らない。
 *
 * ## キャラクター slug
 *
 * VOICEVOX 公式サイトの product URL（`https://voicevox.hiroshiba.jp/product/<slug>/`）を
 * **そのまま**使う。独自にローマ字を当てると読みを誤りやすく（雀松朱司は「すずめまつ」ではなく
 * わかまつ、黒沢冴白は「さはく」ではなくこはく）、公式表記に揃えておけば利用者が
 * 公式サイトで引き当てられる。VOICEVOX Nemo の声だけは公式ページが無いので独自に振る。
 *
 * ## スタイル slug
 *
 * 公式のローマ字表記が無いので独自に振る。規則は
 * - カタカナ英語はその英語綴り（ノーマル → normal、セクシー → sexy、クイーン → queen）
 * - それ以外はヘボン式ローマ字（あまあま → amaama、ささやき → sasayaki、怒り → ikari）
 * - 記号と `ver.` は落とす（人間ver. → ningen、鬼ver. → oni）
 *
 * 全体では衝突する slug がある（`ささやき` と `囁き` はどちらも sasayaki、
 * `かなしみ`・`哀しみ`・`悲しみ` はどれも kanashimi）が、指定は必ず
 * `<キャラクター>/<スタイル>` の形なので **同一キャラクター内で一意なら問題ない**。
 * その一意性は生成スクリプトが検証する。
 */

/** キャラクター名 → slug。 */
export const CHARACTER_SLUGS: Record<string, string> = {
  // --- VOICEVOX 公式サイトの product slug ---
  あいえるたん: 'aierutan',
  暁記ミタマ: 'akatsuki_mitama',
  雨晴はう: 'amehare_hau',
  あんこもん: 'ankomon',
  青山龍星: 'aoyama_ryusei',
  ちび式じい: 'chibishikiji',
  中部つるぎ: 'chubu_tsurugi',
  中国うさぎ: 'chugoku_usagi',
  後鬼: 'goki',
  春歌ナナ: 'haruka_nana',
  '†聖騎士 紅桜†': 'horinaito_benizakura',
  春日部つむぎ: 'kasukabe_tsumugi',
  剣崎雌雄: 'kenzaki_mesuo',
  麒ヶ島宗麟: 'kigashima_sourin',
  琴詠ニア: 'kotoyomi_nia',
  栗田まろん: 'kurita_maron',
  玄野武宏: 'kurono_takehiro',
  黒沢冴白: 'kurosawa_kohaku',
  九州そら: 'kyushu_sora',
  満別花丸: 'manbetsu_hanamaru',
  冥鳴ひまり: 'meimei_himari',
  もち子さん: 'mochikosan',
  波音リツ: 'namine_ritsu',
  猫使アル: 'nekotsuka_aru',
  猫使ビィ: 'nekotsuka_bi',
  'No.7': 'number_seven',
  ナースロボ＿タイプＴ: 'nurserobo_typet',
  櫻歌ミコ: 'ouka_miko',
  離途: 'rito',
  里石ユカ: 'satoishi_yuka',
  '小夜/SAYO': 'sayo',
  四国めたん: 'shikoku_metan',
  白上虎太郎: 'shirakami_kotarou',
  東北イタコ: 'tohoku_itako',
  東北きりたん: 'tohoku_kiritan',
  東北ずん子: 'tohoku_zunko',
  Voidoll: 'voidoll',
  雀松朱司: 'wakamatsu_akashi',
  WhiteCUL: 'white_cul',
  夜語トバリ: 'yogatari_tobari',
  ユーレイちゃん: 'yureichan',
  ぞん子: 'zonko',
  ずんだもん: 'zundamon',

  // --- VOICEVOX Nemo（公式ページが無いので独自） ---
  女声1: 'nemo_female_1',
  女声2: 'nemo_female_2',
  女声3: 'nemo_female_3',
  女声4: 'nemo_female_4',
  女声5: 'nemo_female_5',
  女声6: 'nemo_female_6',
  男声1: 'nemo_male_1',
  男声2: 'nemo_male_2',
  男声3: 'nemo_male_3',
};

/** スタイル名 → slug。同一キャラクター内で一意であればよい。 */
export const STYLE_SLUGS: Record<string, string> = {
  ノーマル: 'normal',
  あまあま: 'amaama',
  甘々: 'amaama',
  ツンツン: 'tsuntsun',
  セクシー: 'sexy',
  'セクシー／あん子': 'sexy_anko',
  ささやき: 'sasayaki',
  囁き: 'sasayaki',
  ヒソヒソ: 'hisohiso',
  内緒話: 'naishobanashi',
  ヘロヘロ: 'herohero',
  へろへろ: 'herohero',
  なみだめ: 'namidame',
  うきうき: 'ukiuki',
  おこ: 'oko',
  怒り: 'ikari',
  おちつき: 'ochitsuki',
  おどおど: 'odoodo',
  おどろき: 'odoroki',
  かなしい: 'kanashii',
  かなしみ: 'kanashimi',
  哀しみ: 'kanashimi',
  悲しみ: 'kanashimi',
  けだるげ: 'kedaruge',
  こわがり: 'kowagari',
  恐怖: 'kyofu',
  しっとり: 'shittori',
  たのしい: 'tanoshii',
  つぼみ: 'tsubomi',
  つよつよ: 'tsuyotsuyo',
  よわよわ: 'yowayowa',
  のんびり: 'nonbiri',
  びえーん: 'bieen',
  びくびく: 'bikubiku',
  ふつう: 'futsuu',
  ぶりっ子: 'burikko',
  わーい: 'waai',
  元気: 'genki',
  明るい: 'akarui',
  アナウンス: 'announce',
  読み聞かせ: 'yomikikase',
  クイーン: 'queen',
  シリアス: 'serious',
  ツクモちゃん: 'tsukumochan',
  ツンギレ: 'tsungire',
  ボーイ: 'boy',
  ロリ: 'loli',
  不機嫌: 'fukigen',
  人見知り: 'hitomishiri',
  低血圧: 'teiketsuatsu',
  呆れ: 'akire',
  喜び: 'yorokobi',
  実況風: 'jikkyofu',
  楽々: 'rakuraku',
  泣き: 'naki',
  熱血: 'nekketsu',
  第二形態: 'daini_keitai',
  絶望と敗北: 'zetsubo_to_haiboku',
  覚醒: 'kakusei',
  'ぬいぐるみver.': 'nuigurumi',
  '人間ver.': 'ningen',
  '人間（怒り）ver.': 'ningen_ikari',
  '鬼ver.': 'oni',
};
