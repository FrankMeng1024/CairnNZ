import React from 'react';
import { View, Text, Image, TouchableOpacity, ImageBackground } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { svgByAsset } from './svgIcons';

// Auto-generated from Friends.spec.json  viewport 375x812
// States: F0, F1, F2, F3, F4, F5, F6

type FriendsState = 'F0' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6';

export function FriendsScreen(props: { state?: FriendsState; initial?: string } = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'F0';
  const initial = props.initial ?? '?';
  return (
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'F0' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F9F7EF' }} />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F0__empty_title}>{'Your trail is better with friends'}</Text>
          <Text style={styles.F0__empty_body}>{'Add someone by email to start sharing the trail.'}</Text>
          <Image source={require('../../../assets/friends/illustrations/home-cairn-master.png')} style={styles.F0__empty_cairn} resizeMode="contain" />
        </>
      )}
      {state === 'F1' && (
        <>
          <Image source={require('../../../assets/friends/backgrounds/friends-bg-footprints.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F1__friends_section_title}>{'Friends'}</Text>
          <View style={styles.F1__friends_list}>
            <View style={styles.F1__friends_list__friend_row_template}>
              <View style={styles.F1__friends_list__friend_row_template__avatar}>
                <Text style={styles.F1__friends_list__friend_row_template__avatar_content}>{initial}</Text>
              </View>
              <Text style={styles.F1__friends_list__friend_row_template__name}>{'{friendName}'}</Text>
              <Text style={styles.F1__friends_list__friend_row_template__meta}>{'{sharedTrailSummary}'}</Text>
            </View>
          </View>
        </>
      )}
      {state === 'F2' && (
        <>
          <Image source={require('../../../assets/friends/backgrounds/friends-bg-footprints.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F2__incoming_title}>{'Incoming'}</Text>
          <View style={styles.F2__incoming_list}>
          </View>
          <Text style={styles.F2__sent_title}>{'Sent'}</Text>
          <View style={styles.F2__sent_list}>
          </View>
        </>
      )}
      {state === 'F3' && (
        <>
          <Image source={require('../../../assets/friends/backgrounds/friends-bg-footprints.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F3__incoming_title}>{'Incoming'}</Text>
          <View style={styles.F3__incoming_list}>
          </View>
          <Text style={styles.F3__no_sent_note}>{'No sent requests yet'}</Text>
        </>
      )}
      {state === 'F4' && (
        <>
          <Image source={require('../../../assets/friends/backgrounds/friends-bg-footprints.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F4__sent_title}>{'Sent'}</Text>
          <View style={styles.F4__sent_list}>
          </View>
          <Text style={styles.F4__no_incoming_note}>{'No incoming requests'}</Text>
        </>
      )}
      {state === 'F5' && (
        <>
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F9F7EF' }} />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.F5__pending_empty_title}>{'No pending requests'}</Text>
          <Text style={styles.F5__pending_empty_body}>{'New requests and sent invites will appear here.'}</Text>
        </>
      )}
      {state === 'F6' && (
        <>
          <Image source={require('../../../assets/friends/backgrounds/friends-bg-footprints.png')} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <View style={styles.shared__header_back}>
            {svgByAsset['icons/back.svg'] ? React.createElement(svgByAsset['icons/back.svg'], { size: styles.shared__header_back.width as number }) : null}
          </View>
          <Text style={styles.shared__header_title}>{'Friends'}</Text>
          <View style={styles.shared__header_add}>
            {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: styles.shared__header_add.width as number }) : null}
          </View>
          <View style={styles.shared__tabs}>
            <TouchableOpacity style={styles.shared__tabs__friends_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__friends_tab_hit_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tabs__pending_tab_hit} onPress={() => {}}>
              <Text style={styles.shared__tabs__pending_tab_hit_label}>Pending</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.shared__add_friend_floating} onPress={() => {}}>
            <View style={styles.shared__add_friend_floating_icon}>
              {svgByAsset['icons/add.svg'] ? React.createElement(svgByAsset['icons/add.svg'], { size: 24 }) : null}
            </View>
            <Text style={styles.shared__add_friend_floating_label}>Add Friend</Text>
          </TouchableOpacity>
          <View style={styles.shared__tab_bar}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>
                {svgByAsset['icons/trails.svg'] ? React.createElement(svgByAsset['icons/trails.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_trails_label}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>
                {svgByAsset['icons/friends.svg'] ? React.createElement(svgByAsset['icons/friends.svg'], { size: 24, color: '#0F5D45' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_friends_label}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>
                {svgByAsset['icons/memory.svg'] ? React.createElement(svgByAsset['icons/memory.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_memory_label}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => {}}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>
                {svgByAsset['icons/settings.svg'] ? React.createElement(svgByAsset['icons/settings.svg'], { size: 24, color: '#143D35' }) : null}
              </View>
              <Text style={styles.shared__tab_bar__tab_settings_label}>Settings</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.F6__sheet_scrim}>
          </View>
          <View style={styles.F6__add_friend_sheet}>
            <Image source={require('../../../assets/friends/hero/add-friend-hero.png')} style={styles.F6__add_friend_sheet__hero} resizeMode="contain" />
            <View style={styles.F6__add_friend_sheet__mail_icon}>
              {svgByAsset['icons/mail.svg'] ? React.createElement(svgByAsset['icons/mail.svg'], { size: styles.F6__add_friend_sheet__mail_icon.width as number }) : null}
            </View>
            <Text style={styles.F6__add_friend_sheet__title}>{'Add a Friend'}</Text>
            <Text style={styles.F6__add_friend_sheet__body}>{'Send a friend request by email.'}</Text>
            <View style={styles.F6__add_friend_sheet__email_input}>
            </View>
            <TouchableOpacity style={styles.F6__add_friend_sheet__send_request} onPress={() => {}}>
              <Text style={styles.F6__add_friend_sheet__send_request_label}>Send Request</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.F6__add_friend_sheet__cancel} onPress={() => {}}>
              <Text style={styles.F6__add_friend_sheet__cancel_label}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}