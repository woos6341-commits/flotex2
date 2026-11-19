import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, Text, View } from "react-native";
import { BUTTON_HEIGHT, BUTTON_WIDTH_FRACTION, canvasHeight, LAYOUT_ACTIONS, type ButtonLayout, type ButtonPosition, type LayoutAction, type LayoutSurface } from "@/shared/button-layout";

type CanvasProps = {
  surface: LayoutSurface;
  layout: ButtonLayout;
  editable?: boolean;
  visible?: (id: string) => boolean;
  onPress?: (action: LayoutAction) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onDrop?: (id: string, x: number, y: number, origin: ButtonPosition) => void;
};

export function ButtonLayoutCanvas({ surface, layout, editable = false, visible, onPress, onMove, onDrop }: CanvasProps) {
  const [width, setWidth] = useState(0);
  const height = canvasHeight(surface);
  const actions = LAYOUT_ACTIONS[surface] as readonly LayoutAction[];
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ width: "100%", height, position: "relative", overflow: "hidden", backgroundColor: editable ? "#0B1018" : "transparent", borderRadius: 16 }}>
    {width > 0 ? layout.positions.map((position) => {
      const action = actions.find((item) => item.id === position.id);
      if (!action || (visible && !visible(position.id))) return null;
      return <CanvasButton key={position.id} action={action} position={position} width={width} height={height} editable={editable} onPress={onPress} onMove={onMove} onDrop={onDrop} />;
    }) : null}
  </View>;
}

function CanvasButton({ action, position, width, height, editable, onPress, onMove, onDrop }: {
  action: LayoutAction; position: ButtonPosition; width: number; height: number; editable: boolean;
  onPress?: CanvasProps["onPress"]; onMove?: CanvasProps["onMove"]; onDrop?: CanvasProps["onDrop"];
}) {
  const current = useRef({ position, width, height, onMove, onDrop });
  current.current = { position, width, height, onMove, onDrop };
  const origin = useRef(position);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { origin.current = current.current.position; },
    onPanResponderMove: (_event, gesture) => {
      const { width: w, height: h, onMove: move } = current.current;
      move?.(action.id, origin.current.x + gesture.dx / (w * (1 - BUTTON_WIDTH_FRACTION)), origin.current.y + gesture.dy / (h - BUTTON_HEIGHT));
    },
    onPanResponderRelease: (_event, gesture) => {
      const { width: w, height: h, onDrop: drop } = current.current;
      drop?.(action.id, origin.current.x + gesture.dx / (w * (1 - BUTTON_WIDTH_FRACTION)), origin.current.y + gesture.dy / (h - BUTTON_HEIGHT), origin.current);
    },
    onPanResponderTerminate: () => current.current.onDrop?.(action.id, origin.current.x, origin.current.y, origin.current),
    onPanResponderTerminationRequest: () => false,
  }), [action.id]);
  const frame = { position: "absolute" as const, left: position.x * width * (1 - BUTTON_WIDTH_FRACTION), top: position.y * (height - BUTTON_HEIGHT), width: width * BUTTON_WIDTH_FRACTION, height: BUTTON_HEIGHT };
  const content = <>
    <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: "#6B5939", backgroundColor: "#D7A9481A" }}><Ionicons name={action.icon} size={23} color="#C8AE78" /></View>
    <Text numberOfLines={2} style={{ color: "#E6E0D5", fontWeight: "600", fontSize: 11, textAlign: "center" }}>{action.label}</Text>
  </>;
  const cardStyle = { alignItems: "center" as const, justifyContent: "center" as const, gap: 7, paddingHorizontal: 5, borderRadius: 20, borderWidth: 1, borderColor: editable ? "#806B43" : "#343B46", backgroundColor: "#10151D" };
  if (editable) return <View {...pan.panHandlers} accessibilityLabel={`اسحب ${action.label}`} style={[frame, cardStyle, Platform.OS === "web" ? ({ touchAction: "none", cursor: "grab" } as any) : null]}>{content}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={() => onPress?.(action)} style={({ pressed }) => [frame, cardStyle, pressed ? { borderColor: "#8B7446", backgroundColor: "#1B2028" } : null]}>{content}</Pressable>;
}
