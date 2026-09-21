/**
 * One import point for every view. With no VITE_SUPABASE_URL set, the app
 * runs entirely in the browser against lib/local.js. Set the two Supabase
 * variables in .env and the same calls go to Postgres instead, with row level
 * security doing the enforcing. No view code changes either way.
 */
import * as local from './local.js';
import * as remote from './supabase.js';

export const IS_LOCAL = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY;

const impl = IS_LOCAL ? local : remote;

/* auth: email and password in both modes, one organization per person */
export const getSession = (...a) => impl.getSession(...a);
export const onAuthChange = (...a) => impl.onAuthChange(...a);
export const signIn = (...a) => impl.signIn(...a);
export const signOut = (...a) => impl.signOut(...a);
export const changeOwnPassword = (...a) => impl.changeOwnPassword(...a);

/* administration: roles are assigned, never chosen by the person holding them */
export const createUser = (...a) => impl.createUser(...a);
export const updateUserRole = (...a) => impl.updateUserRole(...a);
export const removeUser = (...a) => impl.removeUser(...a);
export const resetUserPassword = (...a) => impl.resetUserPassword(...a);
export const createOrganization = (...a) => impl.createOrganization(...a);
export const listAllOrganizations = (...a) => impl.listAllOrganizations(...a);

/* three ways in: sign up, ask to join, reset a password */
export const createPortal = (...a) => impl.createPortal(...a);
export const listOrganizationNames = (...a) => impl.listOrganizationNames(...a);
export const requestAccess = (...a) => impl.requestAccess(...a);
export const listAccessRequests = (...a) => impl.listAccessRequests(...a);
export const approveRequest = (...a) => impl.approveRequest(...a);
export const declineRequest = (...a) => impl.declineRequest(...a);
export const requestPasswordReset = (...a) => impl.requestPasswordReset(...a);
export const resetPassword = (...a) => impl.resetPassword(...a);
export const clearExampleContent = (...a) => impl.clearExampleContent(...a);
export const listOutbox = (...a) => impl.listOutbox(...a);

/* local mode only */
export const resetLocalData = () => (IS_LOCAL ? local.resetLocalData() : undefined);

/* organizations and content */
export const listMyOrganizations = (...a) => impl.listMyOrganizations(...a);
export const getOrganization = (...a) => impl.getOrganization(...a);
export const listMembers = (...a) => impl.listMembers(...a);
export const listCategories = (...a) => impl.listCategories(...a);
export const listValues = (...a) => impl.listValues(...a);
export const listSystemCategories = (...a) => impl.listSystemCategories(...a);
export const createSystemCategory = (...a) => impl.createSystemCategory(...a);
export const deleteSystemCategory = (...a) => impl.deleteSystemCategory(...a);
export const listBehaviors = (...a) => impl.listBehaviors(...a);

/* content editing: a culture champion can change anything in their organization */
export const updateOrganization = (...a) => impl.updateOrganization(...a);
export const setWeeklyBehavior = (...a) => impl.setWeeklyBehavior(...a);
export const setRecentWindow = (...a) => impl.setRecentWindow(...a);
export const setPulseCount = (...a) => impl.setPulseCount(...a);
export const setAutoAdvance = (...a) => impl.setAutoAdvance(...a);
export const listMemberEmails = (...a) => impl.listMemberEmails(...a);

/* billing */
export const getBilling = (...a) => impl.getBilling(...a);
export const setBillingRates = (...a) => impl.setBillingRates(...a);
export const setBillingStatus = (...a) => impl.setBillingStatus(...a);
export const startCheckout = (...a) => impl.startCheckout(...a);
export const cancelSubscription = (...a) => impl.cancelSubscription(...a);
export const resumeSubscription = (...a) => impl.resumeSubscription(...a);
export const listBillingEvents = (...a) => impl.listBillingEvents(...a);
export const applySystemToBehaviors = (...a) => impl.applySystemToBehaviors(...a);
export const setRitualBehaviors = (...a) => impl.setRitualBehaviors(...a);
export const reorderBehaviors = (...a) => impl.reorderBehaviors(...a);
export const updateSystemCategory = (...a) => impl.updateSystemCategory(...a);

/* measures: definitions, then a value per period */
export const listMeasures = (...a) => impl.listMeasures(...a);
export const createMeasure = (...a) => impl.createMeasure(...a);
export const updateMeasure = (...a) => impl.updateMeasure(...a);
export const deleteMeasure = (...a) => impl.deleteMeasure(...a);
export const listMeasureEntries = (...a) => impl.listMeasureEntries(...a);
export const recordMeasureEntry = (...a) => impl.recordMeasureEntry(...a);

/* iterations: one recorded run of a ritual */
export const recordIteration = (...a) => impl.recordIteration(...a);
export const listIterations = (...a) => impl.listIterations(...a);
export const getIteration = (...a) => impl.getIteration(...a);
export const deleteIteration = (...a) => impl.deleteIteration(...a);
export const deleteStory = (...a) => impl.deleteStory(...a);
export const deleteRecognition = (...a) => impl.deleteRecognition(...a);

/* single records for their own pages */
export const getStory = (...a) => impl.getStory(...a);
export const getRecognition = (...a) => impl.getRecognition(...a);
export const getRitual = (...a) => impl.getRitual(...a);

/* pulse rotation */
export const getPulseAssignment = (...a) => impl.getPulseAssignment(...a);
export const getPulseStatus = (...a) => impl.getPulseStatus(...a);
export const createValue = (...a) => impl.createValue(...a);
export const updateValue = (...a) => impl.updateValue(...a);
export const deleteValue = (...a) => impl.deleteValue(...a);
export const createBehavior = (...a) => impl.createBehavior(...a);
export const updateBehavior = (...a) => impl.updateBehavior(...a);
export const deleteBehavior = (...a) => impl.deleteBehavior(...a);
export const setBehaviorValues = (...a) => impl.setBehaviorValues(...a);

/* systems */
export const applySystem = (...a) => impl.applySystem(...a);
export const savePlacementTemplate = (...a) => impl.savePlacementTemplate(...a);
export const removePlacement = (...a) => impl.removePlacement(...a);

/* rituals */
export const listRituals = (...a) => impl.listRituals(...a);
export const createRitual = (...a) => impl.createRitual(...a);
export const saveRitualPractice = (...a) => impl.saveRitualPractice(...a);
export const updateRitual = (...a) => impl.updateRitual(...a);
export const deleteRitual = (...a) => impl.deleteRitual(...a);
export const applyRitual = (...a) => impl.applyRitual(...a);
export const unapplyRitual = (...a) => impl.unapplyRitual(...a);

/* stories and recognition */
export const listStories = (...a) => impl.listStories(...a);
export const createStory = (...a) => impl.createStory(...a);
export const signAttachment = (...a) => impl.signAttachment(...a);
export const shareStoryByEmail = (...a) => impl.shareStoryByEmail(...a);
export const listRecognitions = (...a) => impl.listRecognitions(...a);
export const createRecognition = (...a) => impl.createRecognition(...a);

/* measurement */
export const getPulse = (...a) => impl.getPulse(...a);
export const getCoverage = (...a) => impl.getCoverage(...a);
export const submitPulse = (...a) => impl.submitPulse(...a);
