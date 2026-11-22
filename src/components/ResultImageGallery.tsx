import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RecordAttachment } from '../types/carebridge';
import { validateImageAsset } from '../utils/imageCompression';
import { colors } from '../theme/colors';

export interface ResultImageGalleryProps {
  attachments: RecordAttachment[];
}

const UNTITLED = 'Untitled';

export default function ResultImageGallery({
  attachments,
}: ResultImageGalleryProps): React.JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (attachments.length === 0) {
    return <Text style={styles.empty}>No attachments yet.</Text>;
  }

  const selected: RecordAttachment | null =
    openIndex !== null ? attachments[openIndex] ?? null : null;

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {attachments.map((attachment, index) => {
          const caption = attachment.label?.trim() ? attachment.label.trim() : UNTITLED;
          const key = `${attachment.url}-${index}`;
          const check = validateImageAsset({ uri: attachment.url });

          if (!check.ok) {
            return (
              <View key={key} style={styles.item}>
                <View style={[styles.thumb, styles.placeholder]}>
                  <Text style={styles.placeholderText}>Unsupported image</Text>
                </View>
                <Text style={styles.caption} numberOfLines={1}>
                  {caption}
                </Text>
              </View>
            );
          }

          return (
            <Pressable
              key={key}
              style={styles.item}
              onPress={() => setOpenIndex(index)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${caption}`}
            >
              <Image
                source={{ uri: attachment.url }}
                style={styles.thumb}
                resizeMode="cover"
                accessibilityLabel={caption}
              />
              <Text style={styles.caption} numberOfLines={1}>
                {caption}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenIndex(null)}
      >
        <View style={styles.backdrop}>
          {selected !== null ? (
            <Image
              source={{ uri: selected.url }}
              style={styles.fullImage}
              resizeMode="contain"
              accessibilityLabel={selected.label?.trim() ? selected.label.trim() : UNTITLED}
            />
          ) : null}
          <Pressable
            style={styles.closeButton}
            onPress={() => setOpenIndex(null)}
            accessibilityRole="button"
            accessibilityLabel="Close image"
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 10,
    paddingVertical: 4,
  },
  item: {
    width: 120,
  },
  thumb: {
    width: 120,
    height: 90,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  placeholderText: {
    fontSize: 12,
    color: colors.amber,
    textAlign: 'center',
  },
  caption: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
  },
  empty: {
    fontSize: 13,
    color: colors.textSecondary,
    marginVertical: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fullImage: {
    width: '100%',
    height: '80%',
  },
  closeButton: {
    marginTop: 16,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
});
