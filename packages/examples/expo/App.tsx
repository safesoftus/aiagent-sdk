// One screen: start / end a voice call with the agent, mute, and the
// transcript. Needs a development build (Expo Go cannot load native WebRTC).
import { useState } from "react";
import { Button, FlatList, SafeAreaView, Text, View } from "react-native";
import Constants from "expo-constants";
import {
  ConversationProvider,
  useConversation,
  type MessagePayload,
} from "@convoso/ai-agent-react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { agentId: string; apiOrigin: string };

function Call() {
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [muted, setMuted] = useState(false);
  const conversation = useConversation({
    micMuted: muted,
    onMessage: (m) => setMessages((all) => [...all, m]),
  });
  const live = conversation.status === "connected";
  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text testID="status">Status: {conversation.status}{live ? ` · ${conversation.isSpeaking ? "agent speaking" : "listening"}` : ""}</Text>
      {conversation.message ? <Text testID="error">{conversation.message}</Text> : null}
      <Button testID="start" title="Start call" disabled={live || conversation.status === "connecting"} onPress={() => conversation.startSession()} />
      <Button testID="mute" title={muted ? "Unmute" : "Mute"} disabled={!live} onPress={() => setMuted((m) => !m)} />
      <Button testID="end" title="End call" disabled={!live} onPress={() => conversation.endSession()} />
      <FlatList
        testID="transcript"
        data={messages}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <Text>
            {item.role === "agent" ? "Agent" : "You"}: {item.message}
          </Text>
        )}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ConversationProvider agentId={extra.agentId} origin={extra.apiOrigin}>
        <Call />
      </ConversationProvider>
    </SafeAreaView>
  );
}
