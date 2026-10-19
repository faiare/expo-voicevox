# アプリの release ビルドで R8 が有効なとき（Expo SDK 58 から既定で有効）に、
# このモジュールが壊れないためのルール。consumerProguardFiles でアプリ側へ自動で渡る。

# voicevoxcore-android は Rust の JNI からクラス・フィールド・メソッドを名前で引き、
# AudioQuery / AccentPhrase などは Gson がフィールドを反射で読み書きする。
# jar 自身は consumer rules を同梱していないので、名前の変更も削除もさせない。
# 外すと initialize() が例外も出さずに戻らなくなる。
-keep class jp.hiroshiba.voicevoxcore.** { *; }

# VoicevoxEngine の `object : TypeToken<List<AccentPhrase>>() {}` は総称型の情報を
# 実行時に読む。gson 2.10.1 はルールを同梱していないので、公式の
# examples/android-proguard-example と同じ指定を置く。
-keepattributes Signature
-keepattributes *Annotation*
-keep,allowobfuscation,allowshrinking class com.google.gson.reflect.TypeToken
-keep,allowobfuscation,allowshrinking class * extends com.google.gson.reflect.TypeToken
