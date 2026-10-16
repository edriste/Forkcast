import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { cookingComments } from '../../lib/cookingComments';
import { supabase } from '../../lib/supabase';
import { useResource } from '../../lib/useResource';
import { useLocale } from '../../providers/Locale';
import {
  Button,
  Card,
  Field,
  IconAction,
  Notice,
  SectionHeading,
  useAction,
  useTheme,
} from '../ui';

export function CookingComments({
  eventId,
  userId,
  organizerId,
}: {
  eventId: string;
  userId: string;
  organizerId: string;
}) {
  const { t, locale } = useLocale();
  const { styles, colors } = useTheme();
  const [pages, setPages] = useState(1);
  const resource = useResource(
    useCallback(() => cookingComments(eventId, pages), [eventId, pages]),
    ['cooking', 'organization'],
  );
  const action = useAction();
  const focused = useIsFocused();
  const latest = resource.data?.comments.at(-1)?.id;
  useEffect(() => {
    if (focused && latest)
      void supabase
        .rpc('mark_cooking_comments_seen', { event: eventId, last_comment: latest })
        .then(() => {});
  }, [focused, latest, eventId]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const reset = () => {
    setDraft('');
    setEditing(null);
  };
  return (
    <Card>
      <SectionHeading title={t('Questions & comments')} />
      <Text style={styles.subtitle}>
        {t(
          'Ask about ingredients, portions or payment. Everyone in your organization can join the conversation.',
        )}
      </Text>
      <Notice error={resource.error || action.error} />
      {resource.error && (
        <Button
          secondary
          title={t('Retry comments')}
          onPress={resource.reload}
          busy={resource.loading}
        />
      )}
      {resource.loading && !resource.data && (
        <Text style={styles.subtitle}>{t('Loading comments…')}</Text>
      )}
      {resource.data?.more && (
        <Button
          secondary
          title={t('Show earlier comments')}
          busy={resource.loading}
          onPress={() => setPages(pages + 1)}
        />
      )}
      {resource.data?.comments.length === 0 && (
        <Text style={styles.subtitle}>{t('No comments yet. Start the conversation.')}</Text>
      )}
      {resource.data?.comments.map((comment) => (
        <View
          key={comment.id}
          style={{ gap: 5, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>
                {comment.profiles?.display_name ?? t('Colleague')}
                {comment.author_id === organizerId ? ` · ${t('Organizer')}` : ''}
              </Text>
              <Text style={styles.subtitle}>
                {new Date(comment.created_at).toLocaleString(locale, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {comment.edited_at ? ` · ${t('Edited')}` : ''}
              </Text>
            </View>
            {comment.author_id === userId && (
              <>
                <IconAction
                  title={t('Edit comment')}
                  icon="create-outline"
                  disabled={action.busy || (!!draft.trim() && editing !== comment.id)}
                  onPress={() => {
                    setEditing(comment.id);
                    setDraft(comment.body);
                    setDeleting(null);
                  }}
                />
                <IconAction
                  title={t('Delete comment')}
                  icon="trash-outline"
                  disabled={action.busy}
                  onPress={() => setDeleting(comment.id)}
                />
              </>
            )}
          </View>
          <Text style={styles.text}>{comment.body}</Text>
          {deleting === comment.id && (
            <>
              <Text style={styles.subtitle}>{t('Delete this comment?')}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  title={t('Confirm deletion')}
                  busy={action.busy}
                  onPress={() =>
                    action.run(async () => {
                      const { error } = await supabase.rpc('delete_cooking_comment', {
                        event: eventId,
                        comment_id: comment.id,
                      });
                      if (error) throw error;
                      if (editing === comment.id) reset();
                      setDeleting(null);
                      await resource.reload();
                    })
                  }
                />
                <Button
                  secondary
                  title={t('Cancel')}
                  disabled={action.busy}
                  onPress={() => setDeleting(null)}
                />
              </View>
            </>
          )}
        </View>
      ))}
      <Field
        label={editing ? t('Edit your comment') : t('Your comment')}
        value={draft}
        onChangeText={setDraft}
        multiline
        maxLength={2000}
        editable={!action.busy}
        placeholder={t('Does this contain nuts? Can I reserve two portions?')}
      />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title={editing ? t('Save comment') : t('Post comment')}
          busy={action.busy}
          disabled={!draft.trim()}
          onPress={() =>
            action.run(async () => {
              const { error } = await supabase.rpc('save_cooking_comment', {
                event: eventId,
                comment_body: draft.trim(),
                comment_id: editing,
              });
              if (error) throw error;
              reset();
              await resource.reload();
            })
          }
        />
        {editing && (
          <Button secondary title={t('Cancel editing')} disabled={action.busy} onPress={reset} />
        )}
      </View>
    </Card>
  );
}
