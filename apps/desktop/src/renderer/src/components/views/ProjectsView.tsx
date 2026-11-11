import React, { useState, useId } from 'react';
import { Card } from '../common/Card.js';
import { Badge } from '../common/Badge.js';
import { Alert } from '../common/Alert.js';
import { useProjects } from '../../hooks/useProjects.js';
import { useSites } from '../../hooks/useSites.js';
import type { ProjectDTO, SitePlatformType, SiteEnvironmentType } from '@auditor/shared';

export const ProjectsView: React.FC = () => {
  const [selectedProject, setSelectedProject] = useState<ProjectDTO | null>(null);

  // Project hook
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
    includeArchived: showArchivedProjects,
    setIncludeArchived: setShowArchivedProjects,
    searchQuery,
    setSearchQuery,
    createProject,
    archiveProject,
    restoreProject,
    clearError: clearProjectsError,
  } = useProjects();

  // Sites hook (bound to selectedProject?.id)
  const {
    sites,
    loading: sitesLoading,
    error: sitesError,
    includeArchived: showArchivedSites,
    setIncludeArchived: setShowArchivedSites,
    createSite,
    archiveSite,
    restoreSite,
    clearError: clearSitesError,
  } = useSites(selectedProject?.id);

  // Form states
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteUrl, setNewSiteUrl] = useState('');
  const [newSitePlatform, setNewSitePlatform] = useState<SitePlatformType>('wordpress');
  const [newSiteEnv, setNewSiteEnv] = useState<SiteEnvironmentType>('production');
  const [formSuccessMessage, setFormSuccessMessage] = useState<string | null>(null);

  const searchInputId = useId();
  const showArchivedProjId = useId();
  const projNameId = useId();
  const projDescId = useId();
  const siteNameId = useId();
  const siteUrlId = useId();
  const sitePlatformId = useId();
  const siteEnvId = useId();
  const showArchivedSitesId = useId();

  // Handle Project Creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setFormSuccessMessage(null);
    clearProjectsError();

    const created = await createProject({
      name: newProjectName.trim(),
      description: newProjectDesc.trim() || null,
    });

    if (created) {
      setNewProjectName('');
      setNewProjectDesc('');
      setSelectedProject(created);
      setFormSuccessMessage(`Project "${created.name}" created successfully.`);
    }
  };

  // Handle Project Archival
  const handleArchiveProject = async (project: ProjectDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    setFormSuccessMessage(null);
    const success = await archiveProject(project.id);
    if (success) {
      setFormSuccessMessage(`Project "${project.name}" archived.`);
      if (selectedProject?.id === project.id) {
        setSelectedProject({ ...project, isArchived: true });
      }
    }
  };

  // Handle Project Restoration
  const handleRestoreProject = async (project: ProjectDTO, e: React.MouseEvent) => {
    e.stopPropagation();
    setFormSuccessMessage(null);
    const success = await restoreProject(project.id);
    if (success) {
      setFormSuccessMessage(`Project "${project.name}" restored.`);
      if (selectedProject?.id === project.id) {
        setSelectedProject({ ...project, isArchived: false });
      }
    }
  };

  // Handle Site Creation
  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !newSiteName.trim() || !newSiteUrl.trim()) return;
    setFormSuccessMessage(null);
    clearSitesError();

    const created = await createSite({
      projectId: selectedProject.id,
      name: newSiteName.trim(),
      baseUrl: newSiteUrl.trim(),
      platformType: newSitePlatform,
      environmentType: newSiteEnv,
      description: null,
    });

    if (created) {
      setNewSiteName('');
      setNewSiteUrl('');
      setFormSuccessMessage(`Site "${created.name}" registered successfully.`);
    }
  };

  // Handle Site Archival
  const handleArchiveSite = async (siteId: string, siteName: string) => {
    setFormSuccessMessage(null);
    const success = await archiveSite(siteId);
    if (success) {
      setFormSuccessMessage(`Site "${siteName}" archived.`);
    }
  };

  // Handle Site Restoration
  const handleRestoreSite = async (siteId: string, siteName: string) => {
    setFormSuccessMessage(null);
    const success = await restoreSite(siteId);
    if (success) {
      setFormSuccessMessage(`Site "${siteName}" restored.`);
    }
  };

  return (
    <div className="auditor-projects-view">
      {/* Notifications */}
      {formSuccessMessage && (
        <Alert variant="success" title="Success" onDismiss={() => setFormSuccessMessage(null)}>
          {formSuccessMessage}
        </Alert>
      )}

      {projectsError && (
        <Alert
          variant="danger"
          title={`Project Error: ${projectsError.code}`}
          onDismiss={clearProjectsError}
        >
          {projectsError.message}
        </Alert>
      )}

      {sitesError && (
        <Alert
          variant="danger"
          title={`Site Error: ${sitesError.code}`}
          onDismiss={clearSitesError}
        >
          {sitesError.message}
        </Alert>
      )}

      <div className="auditor-grid-2">
        {/* Left Column: Projects Management */}
        <div>
          {/* Create Project Card */}
          <Card
            title="Create New Project"
            subtitle="Define a workspace for grouped target websites"
          >
            <form onSubmit={handleCreateProject} className="auditor-form">
              <div className="auditor-form-group">
                <label htmlFor={projNameId} className="auditor-label">
                  Project Name
                </label>
                <input
                  id={projNameId}
                  type="text"
                  className="auditor-input"
                  placeholder="e.g. Acme Corp Web Properties"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  disabled={projectsLoading}
                  required
                />
              </div>

              <div className="auditor-form-group">
                <label htmlFor={projDescId} className="auditor-label">
                  Description (Optional)
                </label>
                <textarea
                  id={projDescId}
                  className="auditor-textarea"
                  placeholder="Notes, scope description, or client details"
                  value={newProjectDesc}
                  onChange={e => setNewProjectDesc(e.target.value)}
                  disabled={projectsLoading}
                />
              </div>

              <div className="auditor-form-actions">
                <button
                  type="submit"
                  className="auditor-button auditor-button--primary"
                  disabled={projectsLoading || !newProjectName.trim()}
                >
                  {projectsLoading ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </Card>

          {/* Project List Card */}
          <div className="auditor-section-header">
            <h2 className="auditor-section-title">Projects Directory</h2>
          </div>

          <Card
            title="Existing Projects"
            subtitle={`${projects.length} project${projects.length === 1 ? '' : 's'} available`}
            headerAction={
              <label htmlFor={showArchivedProjId} className="auditor-checkbox-label">
                <input
                  id={showArchivedProjId}
                  type="checkbox"
                  className="auditor-checkbox"
                  checked={showArchivedProjects}
                  onChange={e => setShowArchivedProjects(e.target.checked)}
                />
                Show Archived
              </label>
            }
          >
            <div className="auditor-form-group">
              <input
                id={searchInputId}
                type="text"
                className="auditor-input"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            {projects.length === 0 ? (
              <div className="auditor-empty-state">
                {projectsLoading
                  ? 'Loading projects...'
                  : 'No projects found. Create one above to get started.'}
              </div>
            ) : (
              <ul className="auditor-project-list" role="list">
                {projects.map(proj => {
                  const isSelected = selectedProject?.id === proj.id;
                  return (
                    <li
                      key={proj.id}
                      className={`auditor-project-item ${isSelected ? 'auditor-project-item--active' : ''}`}
                      onClick={() => setSelectedProject(proj)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedProject(proj);
                        }
                      }}
                      aria-pressed={isSelected}
                    >
                      <div className="auditor-project-item__info">
                        <div className="auditor-project-item__name">{proj.name}</div>
                        {proj.description && (
                          <div className="auditor-project-item__desc">{proj.description}</div>
                        )}
                      </div>

                      <div className="auditor-badge-group">
                        {proj.isArchived ? (
                          <Badge variant="neutral" size="sm">
                            Archived
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">
                            Active
                          </Badge>
                        )}

                        {proj.isArchived ? (
                          <button
                            type="button"
                            className="auditor-button auditor-button--secondary auditor-button--sm"
                            onClick={e => handleRestoreProject(proj, e)}
                            title="Restore Project"
                          >
                            Restore
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="auditor-button auditor-button--danger auditor-button--sm"
                            onClick={e => handleArchiveProject(proj, e)}
                            title="Archive Project"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Right Column: Selected Project & Sites Management */}
        <div>
          {selectedProject ? (
            <>
              {/* Selected Project Info & Add Site */}
              <Card
                title={`Manage Sites: ${selectedProject.name}`}
                subtitle={
                  selectedProject.isArchived
                    ? 'Project is archived. Restore project to add new sites.'
                    : 'Register sites and web properties under this project'
                }
                headerAction={
                  selectedProject.isArchived ? (
                    <Badge variant="neutral">Archived Project</Badge>
                  ) : (
                    <Badge variant="info">Active Project</Badge>
                  )
                }
              >
                {!selectedProject.isArchived && (
                  <form onSubmit={handleCreateSite} className="auditor-form">
                    <div className="auditor-form-group">
                      <label htmlFor={siteNameId} className="auditor-label">
                        Site Name
                      </label>
                      <input
                        id={siteNameId}
                        type="text"
                        className="auditor-input"
                        placeholder="e.g. Main Production Store"
                        value={newSiteName}
                        onChange={e => setNewSiteName(e.target.value)}
                        disabled={sitesLoading}
                        required
                      />
                    </div>

                    <div className="auditor-form-group">
                      <label htmlFor={siteUrlId} className="auditor-label">
                        Base URL
                      </label>
                      <input
                        id={siteUrlId}
                        type="url"
                        className="auditor-input auditor-input--mono"
                        placeholder="https://example.com"
                        value={newSiteUrl}
                        onChange={e => setNewSiteUrl(e.target.value)}
                        disabled={sitesLoading}
                        required
                      />
                      <p className="auditor-help-text">
                        Must be valid http:// or https:// URL. Will be normalized to RFC 3986
                        format.
                      </p>
                    </div>

                    <div className="auditor-grid-2">
                      <div className="auditor-form-group">
                        <label htmlFor={sitePlatformId} className="auditor-label">
                          Platform
                        </label>
                        <select
                          id={sitePlatformId}
                          className="auditor-select"
                          value={newSitePlatform}
                          onChange={e => setNewSitePlatform(e.target.value as SitePlatformType)}
                          disabled={sitesLoading}
                        >
                          <option value="wordpress">WordPress</option>
                          <option value="generic_web">Generic Web</option>
                          <option value="custom">Custom</option>
                        </select>
                      </div>

                      <div className="auditor-form-group">
                        <label htmlFor={siteEnvId} className="auditor-label">
                          Environment
                        </label>
                        <select
                          id={siteEnvId}
                          className="auditor-select"
                          value={newSiteEnv}
                          onChange={e => setNewSiteEnv(e.target.value as SiteEnvironmentType)}
                          disabled={sitesLoading}
                        >
                          <option value="production">Production</option>
                          <option value="staging">Staging</option>
                          <option value="development">Development</option>
                          <option value="local">Local</option>
                        </select>
                      </div>
                    </div>

                    <div className="auditor-form-actions">
                      <button
                        type="submit"
                        className="auditor-button auditor-button--primary"
                        disabled={sitesLoading || !newSiteName.trim() || !newSiteUrl.trim()}
                      >
                        {sitesLoading ? 'Registering...' : 'Register Site'}
                      </button>
                    </div>
                  </form>
                )}
              </Card>

              {/* Sites List Card */}
              <div className="auditor-section-header">
                <h2 className="auditor-section-title">Registered Sites</h2>
              </div>

              <Card
                title="Sites in this Project"
                subtitle={`${sites.length} site${sites.length === 1 ? '' : 's'} registered`}
                headerAction={
                  <label htmlFor={showArchivedSitesId} className="auditor-checkbox-label">
                    <input
                      id={showArchivedSitesId}
                      type="checkbox"
                      className="auditor-checkbox"
                      checked={showArchivedSites}
                      onChange={e => setShowArchivedSites(e.target.checked)}
                    />
                    Show Archived
                  </label>
                }
              >
                {sites.length === 0 ? (
                  <div className="auditor-empty-state">
                    {sitesLoading
                      ? 'Loading sites...'
                      : 'No sites found for this project. Register one above.'}
                  </div>
                ) : (
                  <ul className="auditor-site-list" role="list">
                    {sites.map(site => (
                      <li key={site.id} className="auditor-site-item">
                        <div className="auditor-site-item__main">
                          <div className="auditor-site-item__header">
                            <span className="auditor-site-item__name">{site.name}</span>
                            <Badge variant="info" size="sm">
                              {site.platformType}
                            </Badge>
                            <Badge variant="neutral" size="sm">
                              {site.environmentType}
                            </Badge>
                            {site.isArchived && (
                              <Badge variant="danger" size="sm">
                                Archived
                              </Badge>
                            )}
                          </div>
                          <div className="auditor-site-item__url">{site.baseUrl}</div>
                        </div>

                        <div>
                          {site.isArchived ? (
                            <button
                              type="button"
                              className="auditor-button auditor-button--secondary auditor-button--sm"
                              onClick={() => handleRestoreSite(site.id, site.name)}
                              title="Restore Site"
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="auditor-button auditor-button--danger auditor-button--sm"
                              onClick={() => handleArchiveSite(site.id, site.name)}
                              title="Archive Site"
                            >
                              Archive
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : (
            <Card
              title="Site Management"
              subtitle="Select a project from the left column to view and manage its sites"
            >
              <div className="auditor-empty-state">
                <p>No project selected.</p>
                <p>
                  Choose an existing project from the list on the left, or create a new project.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
