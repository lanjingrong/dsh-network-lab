/**
 * Which labs, faults and quiz topics belong to which HCIA phase.
 *
 * This is the only place the three lists are joined. Keep it next to the
 * curriculum: a phase whose lab table is wrong sends the learner to the wrong
 * experiment, and that is worse than having no experiment at all.
 *
 * Rules worth keeping:
 * - `main` is the experiment that teaches the phase from zero; `more` are
 *   variations that revisit it.
 * - `faults` are the cases a learner can diagnose with this phase's knowledge,
 *   not the cases that need later phases.
 * - `topics` are quiz-bank topics, written exactly as quiz.js spells them.
 */
export const PHASE_PLAN = {
  'phase-0': {
    main: ['save-compare'],
    more: [],
    faults: ['f10-save-lost', 'f09-aaa-lockout'],
    topics: [],
  },
  'phase-1': {
    main: ['aaa-telnet'],
    more: ['save-compare'],
    faults: ['f09-aaa-lockout'],
    topics: [],
  },
  'phase-2': {
    main: ['vlan-basic'],
    more: ['hybrid', 'stp-loop'],
    faults: ['f01-vlan-mismatch', 'f02-access-pvid', 'f08-trunk-native', 'f06-stp-loop'],
    topics: ['VLAN', 'Trunk', 'STP'],
  },
  'phase-3': {
    main: ['static-route'],
    more: [],
    faults: ['f03-gateway-missing'],
    topics: ['路由', '静态路由'],
  },
  'phase-4': {
    main: ['ospf-single'],
    more: ['static-route'],
    faults: ['f04-ospf-area'],
    topics: ['OSPF', '路由'],
  },
  'phase-5': {
    main: ['dhcp-server'],
    more: ['acl-basic'],
    faults: ['f07-dhcp-pool', 'f05-acl-direction', 'f11-vlanif-shutdown'],
    topics: ['DHCP', 'ACL'],
  },
  'phase-6': {
    main: ['nat-easyip'],
    more: ['acl-basic'],
    faults: ['f12-compound-nat', 'f03-gateway-missing'],
    topics: ['NAT', 'ACL'],
  },
  'phase-7': {
    main: ['vlan-basic', 'static-route', 'dhcp-server', 'nat-easyip'],
    more: ['ospf-single', 'acl-basic', 'stp-loop'],
    faults: ['f12-compound-nat', 'f08-trunk-native'],
    topics: ['VLAN', 'Trunk', 'OSPF', '路由', 'DHCP', 'NAT', 'ACL'],
  },
  'phase-8': {
    main: [],
    more: ['save-compare', 'aaa-telnet'],
    faults: [
      'f01-vlan-mismatch',
      'f02-access-pvid',
      'f03-gateway-missing',
      'f04-ospf-area',
      'f05-acl-direction',
      'f06-stp-loop',
      'f07-dhcp-pool',
      'f08-trunk-native',
      'f09-aaa-lockout',
      'f10-save-lost',
      'f11-vlanif-shutdown',
      'f12-compound-nat',
    ],
    topics: ['VLAN', 'Trunk', 'STP', 'OSPF', '路由', '静态路由', 'NAT', 'ACL', 'DHCP', 'ARP', '子网划分'],
  },
  'phase-9': {
    main: [],
    more: ['vlan-basic', 'static-route', 'ospf-single', 'nat-easyip', 'acl-basic', 'dhcp-server'],
    faults: ['f12-compound-nat', 'f09-aaa-lockout'],
    topics: ['VLAN', 'Trunk', 'STP', 'OSPF', '路由', '静态路由', 'NAT', 'ACL', 'DHCP', 'ARP', '子网划分'],
  },
}
